/** A pause of the page at a declared server stop's breakpoint that the run itself asked the debugger to resume. */
export interface PagePauseUnderResume {
  /** The declared server stop whose breakpoint the page paused at, as the run's failures name a declared stop. */
  declared: string
  /** Where the page is paused, as {@link pausePlace} names it; `undefined` when only the debugger's report of the stop was read and not the page's own pause. */
  place: string | undefined
}

/**
 * Says in a failure text that the page paused at a declared server stop's breakpoint and what became of Codebook's own resume of it, so the editor agent does not take the failure for a stop whose line did not run.
 * The debugger sets a server stop's breakpoint in the page too, the page pauses there in its copy of the server module, and Codebook resumes that pause itself. {@link ConfiguredBrowserRun} calls this when a deadline expires while that resume has no answer, and when the debugger refuses the resume or does not answer it within its bound.
 * @param pause - The declared server stop and, when known, the place of the page's pause.
 * @param failure - What the resume request failed with (the debugger's refusal, or the bound of the wait for its answer); left out while the request is still unanswered.
 * @returns Three sentences: the pause (with its place when known), what became of the resume (no answer, or the failure in quotation marks), and what to do next.
 * @example
 * pagePauseUnderResumeText({ declared: 'app/lib/actions.ts:27', place: 'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 11:116' })
 * // => "The page paused at webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 11:116, at the breakpoint of declared server stop app/lib/actions.ts:27, which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and got no answer, so the page stayed paused. Keep the declaration and start a new run."
 * pagePauseUnderResumeText({ declared: 'app/lib/actions.ts:27', place: undefined }, 'Thread is not paused')
 * // => "The debugger reported that the page paused at the breakpoint of declared server stop app/lib/actions.ts:27, which it also sets in the page's copy of that module. Codebook asked the debugger to resume the page, and the request failed: \"Thread is not paused\". Keep the declaration and start a new run."
 */
export function pagePauseUnderResumeText(
  pause: PagePauseUnderResume,
  failure?: string,
): string {
  const paused =
      pause.place === undefined
        ? `The debugger reported that the page paused at the breakpoint of declared server stop ${pause.declared}, which it also sets in the page's copy of that module.`
        : `The page paused at ${pause.place}, at the breakpoint of declared server stop ${pause.declared}, which the debugger also sets in the page's copy of that module.`,
    resume =
      failure === undefined
        ? 'Codebook asked the debugger to resume the page and got no answer, so the page stayed paused.'
        : `Codebook asked the debugger to resume the page, and the request failed: "${failure}".`
  // The stop's line is not what failed, so the declaration stays.
  return `${paused} ${resume} Keep the declaration and start a new run.`
}
