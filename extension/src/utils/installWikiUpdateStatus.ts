import type { describeWikiUpdate } from './describeWikiUpdate'
import type { WikiUpdateStatus } from './wikiUpdateRun'

/** What the reader answers at `api/update-status`: the run state, when the site on disk was published (absent while no manifest is readable), which publication it is (absent while the folder holds no publisher's receipt for its manifest) and the reader's source-change stamp. */
export type WikiUpdateStatusAnswer = WikiUpdateStatus & {
  sitePublishedAt?: string
  publication?: string
  /** Rises when a project file that can change freshness was changed; the page reads freshness again when it differs from the one its last check was made for. */
  sourceChangeStamp?: number
}

/** What the served page script hands to {@link installWikiUpdateStatus}: where its reader answers, the shared wording and the page's bounds. */
export type WikiUpdatePageSettings = {
  /** Path prefix of the reader that served the page, for example "/w/<token>/". */
  readerPrefix: string
  /** Route under the prefix that answers the update state; the reader names it, so the page asks where the reader listens. */
  updateStatusRoute: string
  /** Route under the prefix that answers the freshness of the Wiki. */
  freshnessRoute: string
  /** The publication the page's HTML was read from, as the reader wrote it into the page; undefined when that site had no publisher's receipt. The page offers a reload when the reader answers another one. */
  pagePublication: string | undefined
  /** The one wording shared with the editor notification, embedded next to this function. */
  describeUpdate: typeof describeWikiUpdate
  /** How often the page asks for the update state while a run is active or awaited (ms). */
  statusPollMs: number
  /** How often the page asks while nothing is running and the tab is visible (ms). */
  idlePollMs: number
  /** How long after an answered freshness check a mere return to the page asks for no other one (ms). */
  freshnessMinIntervalMs: number
  /** How long after a press of the update link the page waits for the run the learner confirms in the editor (ms). */
  startWaitMs: number
  /** How many failed reads in a row a running update survives before the page says it lost contact. */
  statusRetryLimit: number
  /** How many conflict paths the sentence names before "and N more". */
  pathLimit: number
  /** How many characters of a failure reason the sentence shows. */
  reasonLimitChars: number
  /** Milliseconds in one minute, handed to the embedded sentence writer, which cannot import the constant. */
  msPerMinute: number
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
 *   updateStatusRoute: 'api/update-status',
 *   freshnessRoute: 'api/freshness',
 *   pagePublication: 'dc9d3160…@1837466',
 *   describeUpdate: describeWikiUpdate,
 *   statusPollMs: 2_000,
 *   idlePollMs: 15_000,
 *   freshnessMinIntervalMs: 5_000,
 *   startWaitMs: 120_000,
 *   statusRetryLimit: 3,
 *   pathLimit: 3,
 *   reasonLimitChars: 400,
 *   msPerMinute: 60_000,
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
    // The label, the button and the status read as one callout, with the button as its filled primary control.
    '[data-codebook-update-group]{background:var(--panel-2,Canvas);border:1px solid var(--border,#777);border-radius:6px;padding:.6rem}',
    '[data-codebook-update-group=bare]{background:none;border:0;padding:0}',
    '[data-codebook-update-group]>[data-codebook-freshness]{margin:0 0 .5rem}',
    '[data-codebook-update-group] .wiki-update{background:var(--link,LinkText);color:var(--bg,Canvas);border-color:var(--link,LinkText);font-weight:600}',
    // In the narrow layout the rail is a short scrolling row; the group keeps a bounded column of it and its own height, so the panel encloses its text.
    '@media(max-width:1000px){[data-codebook-update-group]{flex:0 1 18rem;min-width:0;align-self:flex-start}}',
    // A held-back link stays a link: muted and dashed, so it also reads as unavailable in forced colours.
    '.wiki-update[aria-disabled=true]{background:transparent;color:var(--muted,GrayText);border:1px dashed currentColor;cursor:not-allowed}',
    // The status line is smaller than the rail text; an empty one takes no room, so it can stay in the accessibility tree.
    '[data-codebook-update-status]{font-size:.75rem;line-height:1.45;margin:.5rem 0 0;color:var(--text,#333);overflow-wrap:anywhere}',
    '[data-codebook-update-status]:empty{margin:0;padding:0;border:0}',
    // State is carried by the lead words, their weight and their colour together, never by colour alone.
    '[data-codebook-update-status] strong{font-weight:650}',
    '[data-codebook-update-status][data-state=succeeded] strong,[data-codebook-update-status][data-state=already-current] strong,[data-codebook-update-status][data-state=late-publish] strong{color:var(--current,#236b55)}',
    '[data-codebook-update-status][data-state=failed] strong,[data-codebook-update-status][data-state=conflict] strong{color:var(--changed,#8a3a1c)}',
    '[data-codebook-update-status][data-state=timed-out] strong,[data-codebook-update-status][data-state=unreachable] strong{color:var(--unknown,#6b4d00)}',
    '[data-codebook-update-status][data-state=cancelled] strong,[data-codebook-update-status][data-state=awaiting] strong,[data-codebook-update-status][data-state=not-started] strong{color:var(--muted,#625f59)}',
    '[data-codebook-update-status]~[data-codebook-update-detail]{font-size:.75rem;line-height:1.45;margin:.3rem 0 0;overflow-wrap:anywhere}',
    '[data-codebook-update-status]~[data-codebook-update-detail] summary{cursor:pointer}',
    '[data-codebook-update-status]~[data-codebook-update-detail] ul{margin:.3rem 0 0;padding-left:1.1rem}',
    '[data-codebook-update-status]~[data-codebook-update-detail] p{margin:.3rem 0 0}',
    '[data-codebook-update-status]~[data-codebook-reload]{display:block;margin:.5rem 0 0;font:inherit;font-size:.75rem;font-weight:600;cursor:pointer;border:1px solid var(--link,LinkText);border-radius:5px;padding:.3rem .6rem;background:var(--panel,Canvas);color:var(--link,LinkText)}',
    '[data-codebook-update-status]~[data-codebook-update-output]{font-size:.75rem;line-height:1.45;margin:.3rem 0 0;color:var(--muted,#625f59);overflow-wrap:anywhere}',
  ].join('')
  document.head.append(styles)

  const freshnessLabel = document.querySelector<HTMLElement>(
    '[data-codebook-freshness]',
  )
  const updateLink = document.querySelector<HTMLElement>('.wiki-update')
  const updateLinkLabel = updateLink?.textContent ?? ''
  // A site published from the current shell carries an offline placeholder; it becomes the status region.
  const statusRegion =
    document.querySelector<HTMLElement>('[data-codebook-update-status]') ??
    document.createElement('p')
  statusRegion.replaceChildren()
  statusRegion.id = 'codebook-update-status'
  statusRegion.setAttribute('data-codebook-update-status', '')
  // The region is in the accessibility tree from load, so its first sentence is announced, and whole.
  statusRegion.setAttribute('role', 'status')
  statusRegion.setAttribute('aria-atomic', 'true')
  // The label, the button and the status form one group in that order; a site published before the group existed is regrouped here.
  const group =
    document.querySelector<HTMLElement>('[data-codebook-update-group]') ??
    document.createElement('div')
  if (!group.parentNode) {
    const anchor = updateLink ?? freshnessLabel
    group.setAttribute(
      'data-codebook-update-group',
      anchor?.parentNode ? '' : 'bare',
    )
    // A page with neither the button nor the label gets the bare status at its end.
    if (anchor?.parentNode) anchor.parentNode.insertBefore(group, anchor)
    else document.body.append(group)
    if (freshnessLabel) group.append(freshnessLabel)
    if (updateLink) group.append(updateLink)
  }
  if (!statusRegion.parentNode) group.append(statusRegion)
  // The folder and anything the sentence shortened sit beside the region, so an announcement stays one sentence.
  const outputLine = document.createElement('p')
  outputLine.setAttribute('data-codebook-update-output', '')
  const detailBox = document.createElement('details')
  detailBox.setAttribute('data-codebook-update-detail', '')
  // A reload drops the reading position and a typed question, so the learner chooses it; it is never focused for them.
  const reloadButton = document.createElement('button')
  reloadButton.setAttribute('type', 'button')
  reloadButton.setAttribute('data-codebook-reload', '')
  reloadButton.textContent = 'Reload to read the new pages'
  reloadButton.addEventListener('click', () => {
    location.reload()
  })

  // A page this script runs in is served by Codebook: the offline text of the published page gives way to what happens until the first answer.
  if (freshnessLabel) freshnessLabel.textContent = 'Checking freshness…'

  /** The last state the reader answered, and its serialized form for comparing two answers. */
  let lastAnswer: WikiUpdateStatus | undefined
  let lastAnswerText = ''
  /** The last freshness the reader answered; undefined before the first answer and after a read that failed. */
  let freshness: string | undefined
  /** The freshness read in flight and the generation of site and source it reads; a look that needs the same generation joins it. */
  let freshnessRead: { generation: string; done: Promise<void> } | undefined
  /** Freshness reads started so far; an answer counts only while its read is the latest. */
  let freshnessReadCount = 0
  /** The generation the last answered freshness read was made for, and when it was answered (browser clock); undefined until one was answered. */
  let freshnessGeneration: string | undefined
  let freshnessAnsweredAtMs: number | undefined
  /** The generation of site and source the reader last answered; empty before its first answer. */
  let answeredGeneration = ''
  /** When the site on disk was published, as the reader last answered it (epoch ms); undefined while no manifest is readable. */
  let sitePublishedAtMs: number | undefined
  /** Which publication is on disk, as the reader last answered it; the pages on screen are older when it is not the one they were served from. */
  let sitePublication: string | undefined
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
  const isUpdateStatus = (answer: unknown): answer is WikiUpdateStatusAnswer =>
    typeof answer === 'object' &&
    answer !== null &&
    'state' in answer &&
    typeof answer.state === 'string'
  const formatTime = (isoTimestamp: string): string =>
    new Date(isoTimestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })

  const isEndedWithoutSuccess = (state: string): boolean =>
    state === 'failed' ||
    state === 'cancelled' ||
    state === 'timed-out' ||
    state === 'conflict'

  /** Takes in what `api/freshness` answered and writes it into the freshness label. @param status - The answered status, or undefined when the reader did not answer. */
  const noteFreshness = (status: string | undefined, reason: string): void => {
    freshness = status
    if (!freshnessLabel) return
    freshnessLabel.textContent =
      status === 'current'
        ? 'Wiki source current'
        : status === 'changed'
          ? 'Source changed · Update available'
          : 'Wiki freshness unknown'
    freshnessLabel.setAttribute('data-status', status ?? 'unknown')
    if (reason) freshnessLabel.title = reason
  }
  /** Asks the reader how the Wiki stands against the source and writes the answer into the label. @param generation - The generation of site and source the check is for; a check already in flight for it is joined instead of asked twice. @returns A promise that settles when the answer was taken in, or dropped because a newer check was started meanwhile. */
  const readFreshness = (generation: string): Promise<void> => {
    if (freshnessRead?.generation === generation) return freshnessRead.done
    freshnessReadCount += 1
    const readNumber = freshnessReadCount
    const done = (async (): Promise<void> => {
      let answered: { status: string; reason: string } | undefined
      try {
        const answer = await readFromReader(settings.freshnessRoute)
        if (
          typeof answer !== 'object' ||
          answer === null ||
          !('status' in answer) ||
          typeof answer.status !== 'string'
        )
          throw new Error('The freshness answer has no status.')
        answered = {
          status: answer.status,
          reason:
            'reason' in answer && typeof answer.reason === 'string'
              ? answer.reason
              : '',
        }
      } catch {
        answered = undefined
      }
      // A newer check was started for a newer site or source; this late answer must not put its label back over that one's.
      if (readNumber !== freshnessReadCount) return
      freshnessRead = undefined
      if (!answered) {
        noteFreshness(undefined, '')
        return
      }
      freshnessGeneration = generation
      freshnessAnsweredAtMs = Date.now()
      noteFreshness(answered.status, answered.reason)
    })()
    freshnessRead = { generation, done }
    return done
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
      msPerMinute: settings.msPerMinute,
      // The page shows the freshness label above the update line.
      freshnessLabelPlace: 'above',
      // The host names both publications, so the browser's clock decides nothing.
      isPageOlderThanSite: sitePublication !== settings.pagePublication,
    })
    if (!described) return undefined
    const state = lastAnswer.state
    // Freshness is read live and a result is history: a line that says the Wiki matches gives way once the source moved on.
    if (
      (state === 'succeeded' || state === 'already-current') &&
      freshness === 'changed'
    )
      return undefined
    if (
      isEndedWithoutSuccess(state) &&
      'finishedAt' in lastAnswer &&
      freshness === 'current'
    ) {
      // The editor chat may publish after its run was given up; the site on disk then matches the source after all.
      if (
        sitePublishedAtMs !== undefined &&
        sitePublishedAtMs > Date.parse(lastAnswer.finishedAt)
      )
        return {
          state: 'late-publish',
          lead: 'A new site was published',
          rest: ' after this run ended and matches the source.',
          detail: [],
          output: described.output,
          // Only a page served before that publish still shows the older pages.
          offerReload: sitePublication !== settings.pagePublication,
        }
      // Nothing was published since, so the source itself went back to what the site describes: "needs another run" no longer holds.
      if (state === 'failed' && lastAnswer.site === 'replaced') return undefined
    }
    return { state, ...described }
  }
  /** Fills the disclosure with what the sentence shortened: every conflicting file, or the whole failure message. */
  const fillDetail = (shown: Shown): void => {
    const isFileList = shown.state === 'conflict'
    const summary = document.createElement('summary')
    summary.textContent = isFileList
      ? 'Show all ' + shown.detail.length + ' files'
      : 'Show the full message'
    const entries = shown.detail.map((entry) => {
      const item = document.createElement(isFileList ? 'li' : 'p')
      item.textContent = entry
      return item
    })
    if (isFileList) {
      const list = document.createElement('ul')
      list.append(...entries)
      detailBox.replaceChildren(summary, list)
    } else detailBox.replaceChildren(summary, ...entries)
    detailBox.removeAttribute('open')
  }
  /** Writes the sentence into the region and puts what belongs beside it after it: disclosure, reload button, output line. */
  const writeStatus = (shown: Shown | undefined): void => {
    detailBox.remove()
    reloadButton.remove()
    outputLine.remove()
    if (!shown) {
      statusRegion.replaceChildren()
      statusRegion.removeAttribute('data-state')
      return
    }
    const lead = document.createElement('strong')
    lead.textContent = shown.lead
    statusRegion.replaceChildren(lead, shown.rest)
    statusRegion.setAttribute('data-state', shown.state)
    const besideTheRegion: HTMLElement[] = []
    if (shown.detail.length > 0) {
      fillDetail(shown)
      besideTheRegion.push(detailBox)
    }
    if (shown.offerReload) besideTheRegion.push(reloadButton)
    if (shown.output) {
      outputLine.textContent = shown.output
      besideTheRegion.push(outputLine)
    }
    statusRegion.after(...besideTheRegion)
  }
  /** Holds the update link back while a run is active; it stays a focusable link, and its label and the status line say why. */
  const showUpdateLink = (isRunning: boolean): void => {
    if (!updateLink) return
    const label = isRunning ? 'Updating…' : updateLinkLabel
    if (updateLink.textContent !== label) updateLink.textContent = label
    if (isRunning) {
      updateLink.setAttribute('aria-disabled', 'true')
      updateLink.setAttribute('aria-describedby', statusRegion.id)
      return
    }
    updateLink.removeAttribute('aria-disabled')
    updateLink.removeAttribute('aria-describedby')
  }
  /** Puts the current sentence and the state of the update link on the page. */
  const show = (): void => {
    const shown = describeShown()
    const signature = shown ? JSON.stringify(shown) : ''
    // An unchanged look writes nothing: a rewritten live region may be announced again on every poll.
    if (signature !== shownSignature) {
      shownSignature = signature
      writeStatus(shown)
    }
    showUpdateLink(shown?.state === 'running')
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
    // A return to the page asks for freshness again, unless a check was answered a moment ago.
    let isFreshnessDue =
      isReturn &&
      (freshnessAnsweredAtMs === undefined ||
        Date.now() - freshnessAnsweredAtMs >= settings.freshnessMinIntervalMs)
    try {
      const answer = await readFromReader(settings.updateStatusRoute)
      // A newer look is under way; its answer is the one to show.
      if (lookNumber !== lookCount) return
      if (!isUpdateStatus(answer))
        throw new Error('The update answer has no state.')
      const { sitePublishedAt, publication, sourceChangeStamp, ...status } =
        answer
      sitePublication =
        typeof publication === 'string' ? publication : undefined
      const answeredPublishMs =
        typeof sitePublishedAt === 'string'
          ? Date.parse(sitePublishedAt)
          : undefined
      sitePublishedAtMs = answeredPublishMs
      answeredGeneration = answeredPublishMs + '|' + sourceChangeStamp
      // A finished run changes freshness, and so do a publish (the chat may publish after its run was given up) and a changed source file, which the reader's stamp tells without hashing anything. The generation of the last answered check is compared, so a check that failed stays owed.
      if (noteAnswer(status) || answeredGeneration !== freshnessGeneration)
        isFreshnessDue = true
    } catch {
      if (lookNumber !== lookCount) return
      noteFailedRead()
    }
    if (isFreshnessDue) {
      // A result is weighed against freshness before it is shown; a run in progress shows at once.
      if (lastAnswer?.state === 'running' || isUnreachable) show()
      await readFreshness(answeredGeneration)
      if (lookNumber !== lookCount) return
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
