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
  /** How many failed reads in a row a running update survives before the page says it lost contact. */
  statusRetryLimit: number
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
 *   statusRetryLimit: 3,
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

  // Sites published earlier carry their own older stylesheet, so every rule of the update group comes from here.
  const styles = document.createElement('style')
  styles.textContent = [
    // A held-back link stays a link: muted and dashed, so it also reads as unavailable in forced colours.
    '.wiki-update[aria-disabled=true]{background:transparent;color:var(--muted,GrayText);border:1px dashed currentColor;cursor:not-allowed}',
  ].join('')
  document.head.append(styles)

  const freshnessLabel = document.querySelector<HTMLElement>(
    '[data-codebook-freshness]',
  )
  const updateLink = document.querySelector<HTMLElement>('.wiki-update')
  const updateLinkLabel = updateLink?.textContent ?? ''
  const statusRegion = document.createElement('p')
  statusRegion.id = 'codebook-update-status'
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
  /** Reads that failed in a row, and whether the page has given up on its reader for now. */
  let failedReadCount = 0
  let isUnreachable = false
  /** What is on the page now, serialized; empty while the status line says nothing. */
  let shownSignature = ''
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
    failedReadCount = 0
    isUnreachable = false
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

  /** Takes in a read the reader did not answer. */
  const noteFailedRead = (): void => {
    failedReadCount += 1
    // A run in progress outlives a few lost reads before the page gives up on it.
    if (
      lastAnswer?.state === 'running' &&
      failedReadCount <= settings.statusRetryLimit
    )
      return
    // A page that says nothing has nothing to take back.
    if (!shownSignature) return
    isUnreachable = true
    isAwaitingStart = false
  }

  /** Decides what the status line says from everything the page knows. */
  const describeShown = (): Shown | undefined => {
    const pageOnly = { detail: [], output: '', offerReload: false }
    if (isUnreachable)
      return {
        state: 'unreachable',
        lead: 'Lost contact with the editor',
        rest: ', so the update status is unknown. Reopen this Wiki with “Codebook: Open DeepWiki in Browser” to see it. The pages you are reading are unchanged.',
        ...pageOnly,
      }
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
    shownSignature = shown ? JSON.stringify(shown) : ''
    statusRegion.textContent = text
    statusRegion.hidden = !text
    statusRegion.setAttribute('data-state', shown?.state ?? 'idle')
    if (!updateLink) return
    // The link stays a focusable link while it is held back; its label and the status line say why.
    const isRunning = shown?.state === 'running'
    const label = isRunning ? 'Updating…' : updateLinkLabel
    if (updateLink.textContent !== label) updateLink.textContent = label
    if (isRunning) {
      updateLink.setAttribute('aria-disabled', 'true')
      updateLink.setAttribute('aria-describedby', statusRegion.id)
    } else {
      updateLink.removeAttribute('aria-disabled')
      updateLink.removeAttribute('aria-describedby')
    }
  }

  const scheduleNextLook = (): void => {
    window.clearTimeout(pollTimer)
    // A hidden tab keeps no timer; showing it again looks at once.
    if (document.hidden) return
    const isWatchingClosely =
      isAwaitingStart || (lastAnswer?.state === 'running' && !isUnreachable)
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
    } catch {
      if (lookNumber !== lookCount) return
      noteFailedRead()
    }
    show()
    // A reader that stopped answering is asked again, so one lost read heals itself.
    scheduleNextLook()
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
    isUnreachable = false
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
