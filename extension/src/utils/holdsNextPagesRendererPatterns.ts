import { NEXT_PAGES_RENDERER_PATTERNS } from '../constants'

/**
 * Says whether the text of Next's Pages renderer holds the data-function call texts Codebook knows ({@link NEXT_PAGES_RENDERER_PATTERNS}).
 *
 * Why it exists: when Next changes the renderer so that none of the known texts occurs, a frame of it can no longer be told apart from the page component's render, and a hit must not be called "outside the data function" on that basis. Called by {@link pagesDataFunctionHitVerdictOf} once per renderer script of a hit (the run reads the text once), and by the run to journal an unrecognised runtime once with the Next version.
 * @param rendererText - The source text of the renderer script (`Debugger.getScriptSource`).
 * @returns `true` when the text holds the call text or the traced-await text of at least one pattern; `false` for a text that holds none of them.
 * @example
 * holdsNextPagesRendererPatterns('…async()=>getServerSideProps({req:req,…') // => true
 * holdsNextPagesRendererPatterns('module.exports = {}')                      // => false
 */
export function holdsNextPagesRendererPatterns(rendererText: string): boolean {
  return NEXT_PAGES_RENDERER_PATTERNS.some(
    (pattern) =>
      rendererText.includes(pattern.callText) ||
      rendererText.includes(pattern.tracedAwaitText),
  )
}
