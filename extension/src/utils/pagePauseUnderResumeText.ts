/** A pause of the page at a declared server stop's breakpoint that the run itself asked the debugger to resume. */
export interface PagePauseUnderResume {
  /** The declared server stop whose breakpoint the page paused at, as the run's failures name a declared stop. */
  declared: string
  /** Where the page is paused, as {@link pausePlace} names it; `undefined` when only the debugger's report of the stop was read and not the page's own pause. */
  place: string | undefined
}

/** What became of Codebook's own resume of the page when a failure is worded: the debugger has not answered the request, it answered and the page reported no resume, or the request failed with this text (the debugger's refusal, or the bound of the wait for its answer). */
export type PageResumeOutcome = 'unanswered' | 'answered' | { failure: string }

/**
 * Says in a failure text that the page paused at a declared server stop's breakpoint and what became of Codebook's own resume of it, so the editor agent does not take the failure for a stop whose line did not run.
 * The debugger sets a server stop's breakpoint in the page too, the page pauses there in its copy of the server module, and Codebook resumes that pause itself. {@link ConfiguredBrowserRun} calls this when a deadline expires while the page has not reported that resume, and when the debugger refuses the resume or does not answer it within its bound.
 * @param pause - The declared server stop and, when known, the place of the page's pause.
 * @param outcome - What became of the resume request.
 * @returns Three sentences: the pause (with its place when known), what became of the resume ({@link resumeOutcomeText}), and what to do next.
 * @example
 * pagePauseUnderResumeText({ declared: 'app/lib/actions.ts:27', place: 'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 11:116' }, 'unanswered')
 * // => "The page paused at webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 11:116, at the breakpoint of declared server stop app/lib/actions.ts:27, which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and got no answer, so the page stayed paused. Keep the declaration and start a new run."
 * pagePauseUnderResumeText({ declared: 'app/lib/actions.ts:27', place: undefined }, { failure: 'Thread is not paused' })
 * // => "The debugger reported that the page paused at the breakpoint of declared server stop app/lib/actions.ts:27, which it also sets in the page's copy of that module. Codebook asked the debugger to resume the page, and the request failed: \"Thread is not paused\". Keep the declaration and start a new run."
 */
export function pagePauseUnderResumeText(
  pause: PagePauseUnderResume,
  outcome: PageResumeOutcome,
): string {
  const paused =
    pause.place === undefined
      ? `The debugger reported that the page paused at the breakpoint of declared server stop ${pause.declared}, which it also sets in the page's copy of that module.`
      : `The page paused at ${pause.place}, at the breakpoint of declared server stop ${pause.declared}, which the debugger also sets in the page's copy of that module.`
  // The stop's line is not what failed, so the declaration stays.
  return `${paused} ${resumeOutcomeText(outcome)} Keep the declaration and start a new run.`
}

/** Says what became of Codebook's resume of the page, for {@link pagePauseUnderResumeText}: only what was observed, so an answered request is never said to have had no answer. @example resumeOutcomeText({ failure: 'Thread is not paused' }) // 'Codebook asked the debugger to resume the page, and the request failed: "Thread is not paused".' */
function resumeOutcomeText(outcome: PageResumeOutcome): string {
  if (outcome === 'unanswered')
    return 'Codebook asked the debugger to resume the page and got no answer, so the page stayed paused.'
  if (outcome === 'answered')
    return 'Codebook asked the debugger to resume the page and the debugger answered, but the page reported no resume.'
  return `Codebook asked the debugger to resume the page, and the request failed: "${outcome.failure}".`
}
