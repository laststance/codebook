import type { describeWikiUpdate } from './describeWikiUpdate'
import type { WikiUpdateStatus } from './wikiUpdateRun'

/** What the served page script hands to {@link installWikiUpdateStatus}: where its reader answers, the shared wording and the page's bounds. */
export type WikiUpdatePageSettings = {
  /** Path prefix of the reader that served the page, for example "/w/<token>/". */
  readerPrefix: string
  /** The one wording shared with the editor notification, embedded next to this function. */
  describeUpdate: typeof describeWikiUpdate
  /** How often the page asks for the update state while a run is active (ms). */
  statusPollMs: number
  /** How many conflict paths the sentence names before "and N more". */
  pathLimit: number
  /** How many characters of a failure reason the sentence shows. */
  reasonLimitChars: number
}

/**
 * Shows the freshness of the Wiki and the state of its update run in the right rail of a served Wiki page.
 *
 * Why: the learner starts an update from the page and must see it run and end there without a reload.
 * Trigger: the reader embeds this function into `codebook-qa.js` with `toString()` and calls it once per page load, so it must stay free of imports and outer variables; everything it needs arrives in `settings`.
 *
 * @param settings - The reader prefix, the wording function and the page's bounds.
 * @returns Nothing; the page keeps itself current through its own timers and listeners.
 *
 * @example
 * ```ts
 * installWikiUpdateStatus({
 *   readerPrefix: '/w/3f9a/',
 *   describeUpdate: describeWikiUpdate,
 *   statusPollMs: 2_000,
 *   pathLimit: 3,
 *   reasonLimitChars: 200,
 * })
 * ```
 */
export function installWikiUpdateStatus(
  settings: WikiUpdatePageSettings,
): void {
  const freshnessLabel = document.querySelector<HTMLElement>(
    '[data-codebook-freshness]',
  )
  const updateLink = document.querySelector<HTMLElement>('.wiki-update')
  const statusRegion = document.createElement('p')
  statusRegion.setAttribute('data-codebook-update-status', '')
  statusRegion.setAttribute('role', 'status')
  statusRegion.setAttribute('aria-live', 'polite')
  statusRegion.hidden = true
  freshnessLabel?.parentNode?.insertBefore(
    statusRegion,
    freshnessLabel.nextSibling,
  )

  let lastAnswer: WikiUpdateStatus | undefined
  let pollTimer = 0

  /** Reads one route of this page's reader. @throws When the reader is gone or refuses. */
  const readFromReader = async (route: string): Promise<unknown> => {
    const response = await fetch(settings.readerPrefix + route)
    if (!response.ok) throw new Error('The Wiki reader did not answer.')
    const answer: unknown = await response.json()
    return answer
  }
  /** The reader's answer is JSON from another process; a state name is all the page relies on before wording it. */
  const isUpdateStatus = (answer: unknown): answer is WikiUpdateStatus =>
    typeof answer === 'object' &&
    answer !== null &&
    'state' in answer &&
    typeof answer.state === 'string'
  const formatTime = (isoTimestamp: string): string =>
    new Date(isoTimestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })

  /** Writes what `api/freshness` answered into the freshness label. */
  const showFreshness = (status: string, reason: string): void => {
    if (!freshnessLabel) return
    freshnessLabel.textContent =
      status === 'current'
        ? 'Wiki source current'
        : status === 'changed'
          ? 'Source changed — update LLM Wiki'
          : 'Wiki freshness unknown'
    freshnessLabel.setAttribute('data-status', status)
    if (reason) freshnessLabel.title = reason
  }
  const refreshFreshness = async (): Promise<void> => {
    if (!freshnessLabel) return
    try {
      const answer = await readFromReader('api/freshness')
      if (
        typeof answer !== 'object' ||
        answer === null ||
        !('status' in answer) ||
        typeof answer.status !== 'string'
      )
        throw new Error('The freshness answer has no status.')
      showFreshness(
        answer.status,
        'reason' in answer && typeof answer.reason === 'string'
          ? answer.reason
          : '',
      )
    } catch {
      showFreshness('unknown', '')
    }
  }

  /** Puts one answer of `api/update-status` on the page. @returns Whether the run it describes just ended. */
  const showUpdateStatus = (answer: WikiUpdateStatus): boolean => {
    const didRunEnd =
      lastAnswer?.state === 'running' && answer.state !== 'running'
    lastAnswer = answer
    const described = settings.describeUpdate(answer, {
      formatTime,
      pathLimit: settings.pathLimit,
      reasonLimitChars: settings.reasonLimitChars,
      pageLoadedAtMs: performance.timeOrigin,
    })
    const text = described
      ? described.lead + described.rest + ' ' + described.output
      : ''
    statusRegion.textContent = text
    statusRegion.hidden = !text
    statusRegion.setAttribute('data-state', answer.state)
    if (answer.state === 'running')
      updateLink?.setAttribute('aria-disabled', 'true')
    else updateLink?.removeAttribute('aria-disabled')
    return didRunEnd
  }
  const scheduleNextLook = (): void => {
    window.clearTimeout(pollTimer)
    pollTimer = window.setTimeout(() => {
      void refreshUpdateStatus()
    }, settings.statusPollMs)
  }
  const refreshUpdateStatus = async (): Promise<void> => {
    window.clearTimeout(pollTimer)
    try {
      const answer = await readFromReader('api/update-status')
      if (!isUpdateStatus(answer))
        throw new Error('The update answer has no state.')
      // A finished run changes what the freshness label should say.
      if (showUpdateStatus(answer)) void refreshFreshness()
      if (answer.state === 'running') scheduleNextLook()
    } catch {
      statusRegion.hidden = true
    }
  }

  updateLink?.addEventListener('click', (event) => {
    if (updateLink.getAttribute('aria-disabled') === 'true') {
      event.preventDefault()
      return
    }
    // The editor asks for confirmation first; look for the run it starts.
    scheduleNextLook()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    void refreshFreshness()
    void refreshUpdateStatus()
  })
  void refreshFreshness()
  void refreshUpdateStatus()
}
