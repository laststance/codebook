import type { Protocol } from 'devtools-protocol'

import {
  UNANNOUNCED_PAUSE_UNKNOWN_PLACE,
  UNANNOUNCED_PAUSE_UNKNOWN_SCRIPT,
} from '../constants'

import type { PauseStopTarget } from './isPauseAtStop'

/** A declared stop as a place can be named after it: the comparison target plus the repository path the declaration cites. */
export type PausePlaceStop = PauseStopTarget & {
  source: { path: string; line: number }
}

/**
 * Says where a pause is in words an editor agent can act on, for a pause that no debugger stop announced.
 * Called by {@link ConfiguredBrowserRun} when the debug adapter resumes such a pause (the journal entry) and when a deadline expires while one is still open (the failure text).
 * @param event - The pause as the runtime reported it.
 * @param stops - The declared stops of the paused participant; a pause in one of their modules is named by repository path and line.
 * @param scriptUrls - Every script the participant announced, by script id.
 * @returns
 * - In a declared stop's module, where the sealed map gives a line: `<repository path>:<line>`
 * - In any other script with a known URL: `<script URL> <line>:<column>`, the 1-based generated position the journal's `cdp.pause-observed` also holds
 * - In a script with no known URL: `an unknown script <line>:<column>`
 * - With an empty stack: `an unknown place`
 * @example
 * pausePlace(pauseAt('9', 27, 23), [authStop], scriptUrls)  // => 'auth.ts:18'
 * pausePlace(pauseAt('70', 0, 219), [authStop], scriptUrls) // => 'eval-ca9ab6a4.cdp 1:220'
 */
export function pausePlace(
  event: Protocol.Debugger.PausedEvent,
  stops: readonly PausePlaceStop[],
  scriptUrls: ReadonlyMap<string, string>,
): string {
  const location = event.callFrames[0]?.location
  if (!location) return UNANNOUNCED_PAUSE_UNKNOWN_PLACE
  return (
    sourcePlace(location, stops) ??
    generatedPlace(location, scriptUrls.get(location.scriptId))
  )
}

/** Names a location by repository path and line when it lies in a declared stop's module and the sealed map reaches it. @example sourcePlace({ scriptId: '9', lineNumber: 27, columnNumber: 23 }, [authStop]) // 'auth.ts:18' */
function sourcePlace(
  location: Protocol.Debugger.Location,
  stops: readonly PausePlaceStop[],
): string | undefined {
  const stop = stops.find(
    (candidate) => candidate.script?.scriptId === location.scriptId,
  )
  const line = stop?.verifier.originalLine(location)
  return stop && line !== undefined ? `${stop.source.path}:${line}` : undefined
}

/** Names a location by its script URL and 1-based generated position; a script whose URL is unknown or empty is called unknown. @example generatedPlace({ scriptId: '70', lineNumber: 0, columnNumber: 219 }, 'eval-ca9ab6a4.cdp') // 'eval-ca9ab6a4.cdp 1:220' */
function generatedPlace(
  location: Protocol.Debugger.Location,
  url: string | undefined,
): string {
  return `${url || UNANNOUNCED_PAUSE_UNKNOWN_SCRIPT} ${location.lineNumber + 1}:${(location.columnNumber ?? 0) + 1}`
}
