import type { describeWikiUpdate } from './describeWikiUpdate'
import type { WikiUpdateStatus } from './wikiUpdateRun'

/** What the served page script hands to {@link installWikiUpdateStatus}: where its reader answers, the shared wording and the page's bounds. */
export type WikiUpdatePageSettings = {
  /** Path prefix of the reader that served the page, for example "/w/<token>/". */
  readerPrefix: string
  /** The one wording shared with the editor notification, embedded next to this function. */
  describeUpdate: typeof describeWikiUpdate
  /** How often the page asks for the update state while a run is active or awaited (ms). */
  statusPollMs: number
  /** How often the page asks while nothing is running and the tab is visible (ms). */
  idlePollMs: number
  /** How long after a press of the update link the page waits for the run the learner confirms in the editor (ms). */
  startWaitMs: number
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
 *   idlePollMs: 15_000,
 *   startWaitMs: 120_000,
 *   pathLimit: 3,
 *   reasonLimitChars: 200,
 * })
 * ```
 */
export function installWikiUpdateStatus(
  settings: WikiUpdatePageSettings,
): void {
  /** What the status line says now; `lead + rest` is the sentence. */
  type Shown = {
    state: string
    lead: string
    rest: string
    detail: string[]
    output: string
    offerReload: boolean
  }

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

  /** The last state the reader answered, and its serialized form for comparing two answers. */
  let lastAnswer: WikiUpdateStatus | undefined
  let lastAnswerText = ''
  /** After a press of the link: the answer at that moment, and until when the page waits for a different one. */
  let isAwaitingStart = false
  let answerAtPress: string | undefined
  let awaitingStartUntilMs = 0
  let didStartWaitPass = false
  let pollTimer = 0
  let lookCount = 0

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

  /** Takes in one answer of `api/update-status`. @returns Whether the run it describes just ended. */
  const noteAnswer = (answer: WikiUpdateStatus): boolean => {
    const answerText = JSON.stringify(answer)
    const didRunEnd =
      lastAnswer?.state === 'running' && answer.state !== 'running'
    if (isAwaitingStart) {
      // A press before the first answer takes that answer as its starting point.
      answerAtPress ??= answerText
      if (answerText !== answerAtPress) isAwaitingStart = false
      else if (Date.now() >= awaitingStartUntilMs) {
        isAwaitingStart = false
        didStartWaitPass = true
      }
    } else if (answerText !== lastAnswerText) didStartWaitPass = false
    lastAnswer = answer
    lastAnswerText = answerText
    return didRunEnd
  }

  /** Decides what the status line says from everything the page knows. */
  const describeShown = (): Shown | undefined => {
    const pageOnly = { detail: [], output: '', offerReload: false }
    // The page cannot see the editor's confirmation, so it says what it is waiting for and never claims a refusal.
    if (isAwaitingStart)
      return {
        state: 'awaiting',
        lead: 'Confirm the update in your editor',
        rest: ' to start it.',
        ...pageOnly,
      }
    if (didStartWaitPass)
      return {
        state: 'not-started',
        lead: 'No update started.',
        rest: ' Confirm it in the editor, or press Update LLM Wiki again.',
        ...pageOnly,
      }
    if (!lastAnswer) return undefined
    const described = settings.describeUpdate(lastAnswer, {
      formatTime,
      pathLimit: settings.pathLimit,
      reasonLimitChars: settings.reasonLimitChars,
      pageLoadedAtMs: performance.timeOrigin,
    })
    return described && { state: lastAnswer.state, ...described }
  }
  /** Puts the current sentence and the state of the update link on the page. */
  const show = (): void => {
    const shown = describeShown()
    const text = shown
      ? shown.lead + shown.rest + (shown.output && ' ' + shown.output)
      : ''
    statusRegion.textContent = text
    statusRegion.hidden = !text
    statusRegion.setAttribute('data-state', shown?.state ?? 'idle')
    if (shown?.state === 'running')
      updateLink?.setAttribute('aria-disabled', 'true')
    else updateLink?.removeAttribute('aria-disabled')
  }

  const scheduleNextLook = (): void => {
    window.clearTimeout(pollTimer)
    // A hidden tab keeps no timer; showing it again looks at once.
    if (document.hidden) return
    const isWatchingClosely = isAwaitingStart || lastAnswer?.state === 'running'
    pollTimer = window.setTimeout(
      () => {
        void look(false)
      },
      isWatchingClosely ? settings.statusPollMs : settings.idlePollMs,
    )
  }
  /** Asks the reader for the update state and shows it. @param isReturn - Whether the learner just loaded or came back to the page, when freshness may have changed too. */
  const look = async (isReturn: boolean): Promise<void> => {
    window.clearTimeout(pollTimer)
    lookCount += 1
    const lookNumber = lookCount
    if (isReturn) void refreshFreshness()
    try {
      const answer = await readFromReader('api/update-status')
      // A newer look is under way; its answer is the one to show.
      if (lookNumber !== lookCount) return
      if (!isUpdateStatus(answer))
        throw new Error('The update answer has no state.')
      // A finished run changes what the freshness label should say.
      if (noteAnswer(answer)) void refreshFreshness()
      show()
      scheduleNextLook()
    } catch {
      statusRegion.hidden = true
    }
  }

  updateLink?.addEventListener('click', (event) => {
    if (updateLink.getAttribute('aria-disabled') === 'true') {
      event.preventDefault()
      return
    }
    // The editor asks for confirmation before a run exists, so the page watches for the answer to change.
    isAwaitingStart = true
    answerAtPress = lastAnswer && lastAnswerText
    awaitingStartUntilMs = Date.now() + settings.startWaitMs
    didStartWaitPass = false
    show()
    scheduleNextLook()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.clearTimeout(pollTimer)
    else void look(true)
  })
  // A window beside the editor never becomes hidden; focus is when the learner comes back to it.
  window.addEventListener('focus', () => {
    void look(true)
  })
  void look(true)
}
