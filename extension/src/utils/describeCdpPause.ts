import type { Protocol } from 'devtools-protocol'

import {
  REPOSITORY_PAUSE_BREAKPOINT_ID_LIMIT,
  REPOSITORY_PAUSE_BREAKPOINT_ID_LIMIT_CHARS,
  REPOSITORY_PAUSE_FUNCTION_NAME_LIMIT_CHARS,
  REPOSITORY_PAUSE_URL_LIMIT_CHARS,
} from '../constants'

/** Where a CDP pause is, in the generated script: what the run journal keeps about a pause the run may not own. */
export interface CdpPausePlace {
  /** The top frame's script URL, cut to {@link REPOSITORY_PAUSE_URL_LIMIT_CHARS}; `''` when that script was never announced. */
  url: string
  /** 1-based generated line of the top frame; absent for an empty stack. */
  line?: number
  /** 1-based generated column of the top frame; absent for an empty stack. */
  column?: number
  /** The top frame's function name, cut to {@link REPOSITORY_PAUSE_FUNCTION_NAME_LIMIT_CHARS}. */
  functionName?: string
  /** The debugger's own ids of the breakpoints that were hit, bounded in count and length. */
  hitBreakpoints: string[]
}

/** Bounds the hit breakpoint ids, which embed script URLs or URL patterns of any length. @example boundedBreakpointIds({ reason: 'other', callFrames: [], hitBreakpoints: ['1:22:4:auth.ts'] }) // ['1:22:4:auth.ts'] */
function boundedBreakpointIds(event: Protocol.Debugger.PausedEvent): string[] {
  return (event.hitBreakpoints ?? [])
    .slice(0, REPOSITORY_PAUSE_BREAKPOINT_ID_LIMIT)
    .map((id) => id.slice(0, REPOSITORY_PAUSE_BREAKPOINT_ID_LIMIT_CHARS))
}

/**
 * Says where a CDP pause is, so a run journal names the place of a pause that the debug adapter makes and resumes by itself.
 * Called by {@link ConfiguredBrowserRun} for every `Debugger.paused` it observes, before it decides whether the pause is one of its declared stops.
 * @param event - The pause as the debugger reported it.
 * @param scriptUrls - Every script the participant announced, by script id.
 * @returns
 * - With a call frame: its bounded script URL, 1-based generated position, bounded function name and the bounded hit breakpoint ids
 * - With an empty stack: an empty URL and the bounded hit breakpoint ids
 * @example
 * describeCdpPause(
 *   { reason: 'other', hitBreakpoints: ['1:22:4:auth.ts'], callFrames: [frameAt('9', 22, 4, 'getUser')] },
 *   new Map([['9', 'webpack-internal:///(action-browser)/./auth.ts']]),
 * ) // => { url: 'webpack-internal:///(action-browser)/./auth.ts', line: 23, column: 5, functionName: 'getUser', hitBreakpoints: ['1:22:4:auth.ts'] }
 */
export function describeCdpPause(
  event: Protocol.Debugger.PausedEvent,
  scriptUrls: ReadonlyMap<string, string>,
): CdpPausePlace {
  const frame = event.callFrames[0],
    hitBreakpoints = boundedBreakpointIds(event)
  // An empty stack has no place; the hit breakpoints are still worth keeping.
  if (!frame) return { url: '', hitBreakpoints }
  return {
    // A script URL or function name can be of any length; the journal keeps a bounded prefix of each.
    url: (scriptUrls.get(frame.location.scriptId) ?? '').slice(
      0,
      REPOSITORY_PAUSE_URL_LIMIT_CHARS,
    ),
    line: frame.location.lineNumber + 1,
    column: (frame.location.columnNumber ?? 0) + 1,
    functionName: frame.functionName?.slice(
      0,
      REPOSITORY_PAUSE_FUNCTION_NAME_LIMIT_CHARS,
    ),
    hitBreakpoints,
  }
}
