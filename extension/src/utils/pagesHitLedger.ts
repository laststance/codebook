import type { PagesDataFunctionHitVerdict } from './pagesDataFunctionHitVerdictOf'

/** Why a Pages hit was resumed by the run: the reason of the journal event `breakpoint.<reason>`. */
export type PagesResumedReason =
  'other-route' | 'outside-data-function' | 'unattributed-resumed'

/** How many hits of one stop were resumed for one reason (and, for `other-route`, for one route). */
export type PagesResumedHitCount = {
  reason: PagesResumedReason
  route?: string
  count: number
}

/** What the run resource says about the hits of a Pages run: the pauses taken (by evidence), the pauses published `unconfirmed`, and the hits resumed (by reason). */
export type PagesAttributionSummary = {
  taken: { frame: number; request: number }
  unconfirmed: number
  resumed: Partial<Record<PagesResumedReason, number>>
}

/** The resume verdicts of a Pages hit. */
type PagesResumeVerdict = Extract<
  PagesDataFunctionHitVerdict,
  { action: 'resume' }
>

/** Maps a resume verdict's journal event to its reason. */
const REASON_OF_EVENT: Readonly<
  Record<PagesResumeVerdict['event'], PagesResumedReason>
> = {
  'breakpoint.other-route': 'other-route',
  'breakpoint.outside-data-function': 'outside-data-function',
  'breakpoint.unattributed-resumed': 'unattributed-resumed',
}

/**
 * Counts what happened to the hits of the Pages server stops of one run: the resumed hits of each stop (which end a stop that never gets a data-function hit, and are quoted in its not-reached failure) and the attribution summary of the run resource.
 *
 * Why it exists: `configuredBrowserRun.ts` only gathers frames and reads, so the bookkeeping of the verdicts lives here, apart from the journal (whose cap keeps only the first resumed hits of a type). Created once per run by {@link ConfiguredBrowserRun}; fed by its Pages hit handling.
 * @example
 * const ledger = new PagesHitLedger()
 * ledger.recordResumed('src/lib/stats.ts:3', { action: 'resume', event: 'breakpoint.outside-data-function' }) // => 1
 * ledger.resumedHitsOf('src/lib/stats.ts:3') // => [{ reason: 'outside-data-function', count: 1 }]
 */
export class PagesHitLedger {
  private readonly resumedByStop = new Map<
    string,
    Map<string, PagesResumedHitCount>
  >()
  private readonly resumedByReason = new Map<PagesResumedReason, number>()
  private takenByFrame = 0
  private takenByRequest = 0
  private unconfirmedPauses = 0

  /**
   * Counts a hit the run resumed for a stop.
   * @param stop - The declared stop, `<path>:<line>`.
   * @param verdict - The resume verdict.
   * @returns How many hits of this stop were resumed so far, this one included.
   * @example ledger.recordResumed('src/lib/stats.ts:3', { action: 'resume', event: 'breakpoint.other-route', route: '/other' }) // => 1
   */
  recordResumed(stop: string, verdict: PagesResumeVerdict): number {
    const reason = REASON_OF_EVENT[verdict.event]
    const route =
      verdict.event === 'breakpoint.other-route' ? verdict.route : undefined
    const counts = this.resumedByStop.get(stop) ?? new Map()
    this.resumedByStop.set(stop, counts)
    const key = `${reason}\u0000${route ?? ''}`
    const known = counts.get(key)
    counts.set(key, {
      reason,
      ...(route === undefined ? {} : { route }),
      count: (known?.count ?? 0) + 1,
    })
    this.resumedByReason.set(
      reason,
      (this.resumedByReason.get(reason) ?? 0) + 1,
    )
    return this.resumedTotalOf(stop)
  }

  /** Counts a pause taken as the entry page's data function, by the evidence that proved it. @example ledger.recordTaken('frame') */
  recordTaken(evidence: 'frame' | 'request'): void {
    if (evidence === 'frame') this.takenByFrame++
    else this.takenByRequest++
  }

  /** Counts a pause published `unconfirmed`. @example ledger.recordUnconfirmed() */
  recordUnconfirmed(): void {
    this.unconfirmedPauses++
  }

  /**
   * Says how many hits of a stop the run resumed.
   * @param stop - The declared stop, `<path>:<line>`.
   * @returns The total over every reason and route; 0 for a stop with none.
   * @example ledger.resumedTotalOf('src/lib/stats.ts:3') // => 500
   */
  resumedTotalOf(stop: string): number {
    let total = 0
    for (const entry of this.resumedByStop.get(stop)?.values() ?? [])
      total += entry.count
    return total
  }

  /**
   * Lists the resumed hits of a stop by reason, as the not-reached failure's details quote them.
   * @param stop - The declared stop, `<path>:<line>`.
   * @returns One entry per reason (and route), in the order each first happened; empty for a stop with none.
   * @example ledger.resumedHitsOf('src/lib/stats.ts:3') // => [{ reason: 'other-route', route: '/other', count: 2 }]
   */
  resumedHitsOf(stop: string): PagesResumedHitCount[] {
    return [...(this.resumedByStop.get(stop)?.values() ?? [])].map((entry) => ({
      ...entry,
    }))
  }

  /**
   * Gives the attribution summary of the run resource.
   * @returns The pauses taken by evidence, the `unconfirmed` pauses, and the resumed hits by reason (only reasons that happened).
   * @example ledger.summary() // => { taken: { frame: 1, request: 0 }, unconfirmed: 0, resumed: { 'other-route': 2 } }
   */
  summary(): PagesAttributionSummary {
    return {
      taken: { frame: this.takenByFrame, request: this.takenByRequest },
      unconfirmed: this.unconfirmedPauses,
      resumed: Object.fromEntries(this.resumedByReason),
    }
  }
}
