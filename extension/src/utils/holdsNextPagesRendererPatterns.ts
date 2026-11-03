import { NEXT_PAGES_RENDERER_PATTERNS } from '../constants'

/**
 * Says whether a script's text is Next's Pages renderer as Codebook knows it: it holds the renderer's traced data-function call site of at least one pattern ({@link NEXT_PAGES_RENDERER_PATTERNS}' `tracedAwaitText`, `trace_constants.RenderSpan.getServerSideProps`).
 *
 * Why it exists: when Next changes the renderer's call sites, a frame of it can no longer be told apart from the page component's render, and a hit must not be called "outside the data function" on that basis; and a script the proxy never announced is taken for the renderer only on this text. Only the call site counts: the tracer-constants enum that every compiled Next runtime bundles (`RenderSpan.getStaticProps="Render.getStaticProps"`) has no `trace_constants.` prefix, and a page module that declares `async function getServerSideProps(` holds the bare call text. Called by {@link pagesDataFunctionHitVerdictOf} once per renderer script of a hit (the run reads the text once), and by the run to journal an unrecognised runtime once with the Next version and to find the renderer among the scripts the proxy never announced.
 * @param rendererText - The source text of a script (`Debugger.getScriptSource`).
 * @returns `true` when the text holds the traced call site of at least one pattern; `false` for any other text, also for a runtime that holds only the tracer-constants enum and for a page module.
 * @example
 * holdsNextPagesRendererPatterns('…data=await (0,tracer_.getTracer)().trace(trace_constants.RenderSpan.getServerSideProps,{…') // => true
 * holdsNextPagesRendererPatterns('(RenderSpan=RenderSpan1||{}).getServerSideProps="Render.getServerSideProps",RenderSpan.getStaticProps="Render.getStaticProps"') // => false
 * holdsNextPagesRendererPatterns('export async function getServerSideProps({ query }) {') // => false
 */
export function holdsNextPagesRendererPatterns(rendererText: string): boolean {
  return NEXT_PAGES_RENDERER_PATTERNS.some((pattern) =>
    rendererText.includes(pattern.tracedAwaitText),
  )
}
