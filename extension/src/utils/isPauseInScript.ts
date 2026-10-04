import type { Protocol } from 'devtools-protocol'

/**
 * Tells whether a pause's top frame is in a given script.
 * {@link ConfiguredBrowserRun} asks this when an accepted stop's own pause never arrived on its bound line: a pause that stayed elsewhere in the stop's module is the announced one and must be judged, a pause in any other script is not.
 * @param event - The pause as the runtime reported it.
 * @param script - The script to compare with, or none while the runtime has not announced it.
 * @returns `true` only when the pause has a top frame and that frame's script is the given one.
 * @example
 * isPauseInScript(pauseAt('9', 27, 23), { scriptId: '9' }) // => true
 * isPauseInScript(pauseAt('9', 27, 23), undefined)         // => false
 */
export function isPauseInScript(
  event: Protocol.Debugger.PausedEvent,
  script: Pick<Protocol.Debugger.ScriptParsedEvent, 'scriptId'> | undefined,
): boolean {
  return (
    script !== undefined &&
    event.callFrames[0]?.location.scriptId === script.scriptId
  )
}
