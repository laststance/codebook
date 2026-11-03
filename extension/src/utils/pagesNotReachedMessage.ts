import type { PagesResumedHitCount } from './pagesHitLedger'

/** What {@link pagesNotReachedMessage} words. */
export type PagesNotReachedWordingFacts = {
  /** The declared stop, `<path>:<line>`. */
  place: string
  /** `entry-render` for a stop of the entry load, `after-operation` for a render observed after an operation. */
  phase: 'entry-render' | 'after-operation'
  /** `load-first`: the page finished loading before the stop was hit; `not-hit`: the active bound expired first. Only the entry render distinguishes them. */
  how: 'load-first' | 'not-hit'
  /** The operation (1-based) of an `after-operation` stop. */
  operationIndex?: number
  /** The active bound, in seconds. */
  seconds: number
  /** The hits of this stop the run resumed, by reason. */
  resumedHits: readonly PagesResumedHitCount[]
}

/** The reasons whose resumed hits mean the line ran, but not inside the entry page's data function. */
const OUTSIDE_REASONS: ReadonlySet<PagesResumedHitCount['reason']> = new Set([
  'other-route',
  'outside-data-function',
])

/**
 * Words the message of `SERVER_STOP_NOT_REACHED` for a Pages run: the line did not run inside the entry page's data function for the observed request, what the learner can change, and, when the run resumed hits of the line, that they may have run outside the data function.
 *
 * Why it exists: App Router's not-reached advice (module scope, `'use cache'`) does not fit a Pages data function, whose stop is taken only inside the call Next's renderer makes to it. Called by {@link ConfiguredBrowserRun} for an entry-render or after-operation stop of a Pages run that no taken hit reached.
 * @param facts - The stop, the phase, how it ended and the resumed hits of the stop.
 * @returns One message, without the code prefix.
 * @example
 * pagesNotReachedMessage({ place: 'src/lib/stats.ts:3', phase: 'entry-render', how: 'not-hit', seconds: 20, resumedHits: [] })
 * // => "The page did not reach declared stop src/lib/stats.ts:3 inside the entry page's data function (getServerSideProps or getStaticProps) for the observed request within 20 s of the entry navigation. …"
 */
export function pagesNotReachedMessage(
  facts: PagesNotReachedWordingFacts,
): string {
  const where =
    facts.phase === 'after-operation'
      ? `Declared stop ${facts.place} was not reached inside the entry page's data function (getServerSideProps or getStaticProps) for the request operation ${facts.operationIndex} made within ${facts.seconds} s after it.`
      : facts.how === 'load-first'
        ? `The page finished without reaching declared stop ${facts.place} inside the entry page's data function (getServerSideProps or getStaticProps) for the observed request.`
        : `The page did not reach declared stop ${facts.place} inside the entry page's data function (getServerSideProps or getStaticProps) for the observed request within ${facts.seconds} s of the entry navigation.`
  const outside = facts.resumedHits.filter((hit) =>
    OUTSIDE_REASONS.has(hit.reason),
  )
  const resumed = outside.length
    ? ` Codebook resumed ${outside.reduce((total, hit) => total + hit.count, 0)} hit(s) of this line (${outside.map(describeResumedHit).join('; ')}): the line may have run outside the entry page's data function.`
    : ''
  return `${where} The line did not run there for this request.${resumed} Declare the stop on a line the data function runs for that request or in code it calls, or declare a browser stop for code the page component runs, then start a new run.`
}

/** Words one count of resumed hits. @example describeResumedHit({ reason: 'other-route', route: '/other', count: 2 }) // => "2 in another page's data function (/other)" */
function describeResumedHit(hit: PagesResumedHitCount): string {
  return hit.reason === 'other-route'
    ? `${hit.count} in another page's data function (${hit.route ?? 'route unread'})`
    : `${hit.count} outside every data function`
}
