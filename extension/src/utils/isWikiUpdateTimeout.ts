import { WIKI_UPDATE_TIMED_OUT_ERROR_NAME } from '../constants'

/**
 * Says whether a Cursor agent run ended because its bound passed; called by the extension when the run has settled, so the run is recorded as `timed-out` and not as a failure.
 * @param agentError - What the agent run threw; `undefined` when it threw nothing.
 * @returns `true` only for an error named {@link WIKI_UPDATE_TIMED_OUT_ERROR_NAME}, which {@link runCursorWikiUpdate} throws at the bound.
 * @example
 * isWikiUpdateTimeout(Object.assign(new Error('Cursor Agent timed out updating the Wiki.'), { name: 'WikiUpdateTimedOut' })) // => true
 * isWikiUpdateTimeout(new Error('The Wiki update was cancelled.'))                                                        // => false
 */
export function isWikiUpdateTimeout(agentError: unknown): boolean {
  return (
    typeof agentError === 'object' &&
    agentError !== null &&
    'name' in agentError &&
    agentError.name === WIKI_UPDATE_TIMED_OUT_ERROR_NAME
  )
}
