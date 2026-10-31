import { redactNextEntryPath } from './redactNextEntryPath'

/** When a Pages run found the page away from its entry path, and what that means for what was sent. */
export type NextEntryLeftMoment =
  | 'after-load'
  | 'before-input'
  | 'before-click-no-inputs'
  | 'before-click-after-inputs'

/** The clause of each moment: when the page was seen elsewhere and what Codebook therefore did not send. */
const MOMENT_CLAUSES: Record<NextEntryLeftMoment, string> = {
  'after-load':
    'once the page loaded (a redirect in the page), so Codebook sent no input or click',
  'before-input':
    'before the first input was written (a client redirect), so Codebook sent no input or click',
  'before-click-no-inputs':
    'before the click was sent (a client redirect), so Codebook sent no click',
  'before-click-after-inputs':
    'before the click was sent (a client redirect); the declared inputs were written and Codebook sent no click',
}

/**
 * Words the `NEXT_ENTRY_REDIRECTED` refusal of a Pages page that is no longer at its entry path: both paths, origin-less and redacted, the moment it was seen and what was not sent.
 *
 * Why it exists: a Pages run observes only the page its entry path renders, so a client redirect after the load, or one that lands later before an input, ends the run before that input. Called by the configured browser run after the page loaded, before the first initial input and right before the click.
 * @param entryPath - The configured entry path.
 * @param pathname - The page's `location.pathname` when it was read.
 * @param moment - When it was read.
 * @returns The message.
 * @example
 * nextEntryLeftMessage('/dashboard', '/login', 'before-click-no-inputs')
 * // => 'The page left the entry path /dashboard for /login before the click was sent (a client redirect), so Codebook sent no click; the browser Codebook opened is closed with the run.'
 */
export function nextEntryLeftMessage(
  entryPath: string,
  pathname: string,
  moment: NextEntryLeftMoment,
): string {
  return `The page left the entry path ${redactNextEntryPath(entryPath)} for ${redactNextEntryPath(pathname)} ${MOMENT_CLAUSES[moment]}; the browser Codebook opened is closed with the run.`
}
