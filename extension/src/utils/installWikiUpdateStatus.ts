import type {
  describeWikiUpdate,
  WikiUpdateDescription,
} from './describeWikiUpdate'
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
  /** How many characters of a reported failure reason the sentence shows, and of a freshness reason the label. */
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
 *   reasonLimitChars: 160,
 *   msPerMinute: 60_000,
 * })
 * ```
 */
export function installWikiUpdateStatus(
  settings: WikiUpdatePageSettings,
): void {
  /** What the status line says now; `lead + rest` is the sentence. */
  type Shown = { state: string } & WikiUpdateDescription

  // Sites published earlier carry their own older stylesheet, so every rule of the update group comes from here.
  const styles = document.createElement('style')
  styles.textContent = [
    // The label, the button and the status read as one callout, with the button as its filled primary control.
    '[data-codebook-update-group]{background:var(--panel-2,Canvas);border:1px solid var(--border,#777);border-radius:6px;padding:.6rem}',
    '[data-codebook-update-group=bare]{background:none;border:0;padding:0}',
    '[data-codebook-update-group]>[data-codebook-freshness]{margin:0 0 .5rem;overflow-wrap:anywhere}',
    '[data-codebook-update-group] .wiki-update{background:var(--link,LinkText);color:var(--bg,Canvas);border-color:var(--link,LinkText);font-weight:600}',
    // While a reload is offered it is the one action that changes what the learner reads: Reload is the filled button and the update button is outlined.
    '[data-codebook-update-group][data-codebook-reload-offered] .wiki-update:not([aria-disabled=true]){background:var(--panel,Canvas);color:var(--link,LinkText)}',
    // Both buttons answer the pointer and a press at once, without a transition; a held-back button does not.
    '.wiki-update:not([aria-disabled=true]):hover,[data-codebook-reload]:hover{filter:brightness(.9)}',
    '.wiki-update:not([aria-disabled=true]):active,[data-codebook-reload]:active{filter:brightness(.8)}',
    // In the narrow layout the rail is a short scrolling row; the group keeps a bounded column of it and its own height, so the panel encloses its text.
    '@media(max-width:1000px){[data-codebook-update-group]{flex:0 1 18rem;min-width:0;align-self:flex-start}}',
    // A held-back link stays a link: muted and dashed, so it also reads as unavailable in forced colours.
    '.wiki-update[aria-disabled=true]{background:transparent;color:var(--muted,GrayText);border:1px dashed currentColor;cursor:not-allowed}',
    // The status line is smaller than the rail text; an empty one takes no room, so it can stay in the accessibility tree.
    '[data-codebook-update-status]{font-size:.75rem;line-height:1.45;margin:.5rem 0 0;color:var(--text,#333);overflow-wrap:anywhere}',
    '[data-codebook-update-status]:empty{margin:0;padding:0;border:0}',
    // State is carried by the lead words, their weight and their colour together, never by colour alone.
    '[data-codebook-update-status] strong{font-weight:650}',
    // The clause that names the control below the region is announced with the sentence and not printed above that control.
    '[data-codebook-update-status] [data-codebook-update-note]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
    '[data-codebook-update-status][data-state=succeeded] strong,[data-codebook-update-status][data-state=already-current] strong,[data-codebook-update-status][data-state=late-publish] strong{color:var(--current,#236b55)}',
    '[data-codebook-update-status][data-state=failed] strong,[data-codebook-update-status][data-state=conflict] strong{color:var(--changed,#8a3a1c)}',
    '[data-codebook-update-status][data-state=timed-out] strong,[data-codebook-update-status][data-state=unreachable] strong{color:var(--unknown,#6b4d00)}',
    '[data-codebook-update-status][data-state=cancelled] strong,[data-codebook-update-status][data-state=awaiting] strong,[data-codebook-update-status][data-state=not-started] strong{color:var(--muted,#625f59)}',
    '[data-codebook-update-status]~[data-codebook-update-detail]{font-size:.75rem;line-height:1.45;margin:.3rem 0 0;overflow-wrap:anywhere}',
    '[data-codebook-update-status]~[data-codebook-update-detail] summary{cursor:pointer}',
    '[data-codebook-update-status]~[data-codebook-update-detail] ul{margin:.3rem 0 0;padding-left:1.1rem}',
    '[data-codebook-update-status]~[data-codebook-update-detail] p{margin:.3rem 0 0}',
    '[data-codebook-update-status]~[data-codebook-reload]{display:block;margin:.5rem 0 0;font:inherit;font-size:.75rem;font-weight:600;cursor:pointer;border:1px solid var(--link,LinkText);border-radius:5px;padding:.3rem .6rem;background:var(--link,LinkText);color:var(--bg,Canvas)}',
    '[data-codebook-update-status]~[data-codebook-update-output]{font-size:.75rem;line-height:1.45;margin:.3rem 0 0;color:var(--muted,#625f59);overflow-wrap:anywhere}',
    // The line that says the overview stands in for a missing page sits above the article's title.
    '[data-codebook-missing-page]{margin:0;padding:.5rem .7rem;font-size:.875rem;line-height:1.45;border:1px solid var(--border,#777);border-radius:6px;background:var(--panel-2,Canvas);color:var(--text,#333);overflow-wrap:anywhere}',
  ].join('')
  document.head.append(styles)

  // The reader sends a request for a page the Wiki does not have to the overview and names that page in the address.
  const addressQuery = new URLSearchParams(location.search)
  const missingPage = addressQuery.get('missing')
  if (missingPage !== null) {
    // The address can be written by anyone: its text is shown only when it is a page path as the publisher allows them.
    const isPagePath =
      missingPage.endsWith('.html') &&
      !missingPage.startsWith('/') &&
      !/[\\\x00-\x1f?#:]/.test(missingPage) &&
      missingPage
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..')
    const missingLine = document.createElement('p')
    missingLine.setAttribute('data-codebook-missing-page', '')
    missingLine.setAttribute('role', 'status')
    missingLine.textContent =
      (isPagePath
        ? 'The page ' + missingPage + ' is not in this Wiki.'
        : 'The page you asked for is not in this Wiki.') +
      ' The last update may have removed it. This is the overview.'
    // The learner's eye lands on the article, so the line is the first element of the reading column, above the title.
    const readingColumn =
      document.querySelector<HTMLElement>('.reading-column') ?? document.body
    readingColumn.insertBefore(missingLine, readingColumn.firstChild)
    // Shown once: a reload or a copied address no longer names the missing page.
    addressQuery.delete('missing')
    const remainingQuery = addressQuery.toString()
    history.replaceState(
      null,
      '',
      location.pathname +
        (remainingQuery ? '?' + remainingQuery : '') +
        location.hash,
    )
  }

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
  /** Words a timestamp as the learner's local hour and minute, with day and month in front when it is not of today, so a result of an earlier day does not read as today's. @example formatTime('2026-10-03T12:10:00.000Z') // => '21:10' today, '3 Oct, 21:10' on a later day */
  const formatTime = (isoTimestamp: string): string => {
    const moment = new Date(isoTimestamp)
    const time = moment.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
    return moment.toDateString() === new Date(Date.now()).toDateString()
      ? time
      : moment.toLocaleDateString([], { day: 'numeric', month: 'short' }) +
          ', ' +
          time
  }

  const isEndedWithoutSuccess = (state: string): boolean =>
    state === 'failed' ||
    state === 'cancelled' ||
    state === 'timed-out' ||
    state === 'conflict'

  /** Words the freshness label of a check that could not decide; {@link noteFreshness} asks for it before it knows which label applies. @param reason - Why the check could not decide; empty when the answer gave none. @returns "Wiki freshness unknown", followed by the reason when there is one, shortened to the rail's limit. @example undecidedFreshnessLabel('The manifest is unreadable.') // => 'Wiki freshness unknown: The manifest is unreadable.' */
  const undecidedFreshnessLabel = (reason: string): string => {
    // The label sits above the outline in a narrow rail: a long reason is cut at the last space before the rail's limit and stays whole in the tooltip.
    const lastSpace = reason.lastIndexOf(' ', settings.reasonLimitChars)
    const shownReason =
      reason.length > settings.reasonLimitChars
        ? reason
            .slice(0, lastSpace > 0 ? lastSpace : settings.reasonLimitChars)
            .trimEnd() + '…'
        : reason
    return reason
      ? 'Wiki freshness unknown: ' + shownReason
      : 'Wiki freshness unknown'
  }
  /** Chooses the text of the freshness label for one answer; called by {@link noteFreshness} on every answered or failed check. @param status - The answered status, or undefined when the reader did not answer. @param undecidedLabel - The label of a check that could not decide, from {@link undecidedFreshnessLabel}. @param isAdditionUnchecked - Whether added files were not looked for. @returns The label of a changed source, of a current one (with the note on unchecked additions), or `undecidedLabel` for any other status. @example freshnessLabelText('current', 'Wiki freshness unknown', false) // => 'Wiki source current' */
  const freshnessLabelText = (
    status: string | undefined,
    undecidedLabel: string,
    isAdditionUnchecked: boolean,
  ): string => {
    if (status === 'changed') return 'Source changed · Update available'
    if (status !== 'current') return undecidedLabel
    return isAdditionUnchecked
      ? 'Wiki source current (no Git revision recorded, so added files are not checked)'
      : 'Wiki source current'
  }
  /** Takes in what `api/freshness` answered and writes it into the freshness label; called by {@link readFreshness} when its check is answered or fails. @param status - The answered status, or undefined when the reader did not answer. @param reason - Why a check could not decide; empty when the answer gave none. @param isAdditionUnchecked - Whether the project has no Git repository, so added files were not looked for. @returns Nothing; the label, its `data-status` and its tooltip are written when the page has a label. @example noteFreshness('unknown', 'The manifest is unreadable.', false) // the label reads "Wiki freshness unknown: The manifest is unreadable." */
  const noteFreshness = (
    status: string | undefined,
    reason: string,
    isAdditionUnchecked: boolean,
  ): void => {
    freshness = status
    if (!freshnessLabel) return
    // A check that could not decide says why in the label itself: a tooltip needs a pointer, and a paragraph cannot take the focus.
    const undecidedLabel = undecidedFreshnessLabel(reason)
    freshnessLabel.textContent = freshnessLabelText(
      status,
      undecidedLabel,
      isAdditionUnchecked,
    )
    freshnessLabel.setAttribute('data-status', status ?? 'unknown')
    // The reason of an earlier look must not outlive it.
    if (reason) freshnessLabel.setAttribute('title', reason)
    else freshnessLabel.removeAttribute('title')
  }
  /** What one answer of `api/freshness` says, as {@link noteFreshness} takes it in. */
  type AnsweredFreshness = {
    status: string
    reason: string
    isAdditionUnchecked: boolean
  }
  /** Tells whether an answer of `api/freshness` names a status; the answer is JSON from another process, and {@link takeFreshnessAnswer} relies on nothing else before it reads it. @param answer - What the freshness route answered. @returns true for an object whose `status` is a string, false for anything else. @example hasFreshnessStatus({ status: 'current' }) // => true; hasFreshnessStatus({ error: 'Unknown route.' }) // => false */
  const hasFreshnessStatus = (answer: unknown): answer is { status: string } =>
    typeof answer === 'object' &&
    answer !== null &&
    'status' in answer &&
    typeof answer.status === 'string'
  /** Reads the reason of an undecided check out of a freshness answer; called by {@link takeFreshnessAnswer}. @param answer - The answered object. @returns Its `reason` when that is a string, otherwise an empty string. @example answeredReason({ status: 'unknown', reason: 'The manifest is unreadable.' }) // => 'The manifest is unreadable.' */
  const answeredReason = (answer: object): string =>
    'reason' in answer && typeof answer.reason === 'string' ? answer.reason : ''
  /** Turns what `api/freshness` answered into what {@link noteFreshness} takes in; called by {@link readFreshness} right after the answer arrived. @param answer - What the freshness route answered. @returns The status, the reason (empty when none was given) and whether added files were not checked. @throws When the answer names no status; {@link readFreshness} takes that like a read that failed. @example takeFreshnessAnswer({ status: 'current', addedFilesUnchecked: true }) // => { status: 'current', reason: '', isAdditionUnchecked: true } */
  const takeFreshnessAnswer = (answer: unknown): AnsweredFreshness => {
    if (!hasFreshnessStatus(answer))
      throw new Error('The freshness answer has no status.')
    return {
      status: answer.status,
      reason: answeredReason(answer),
      isAdditionUnchecked:
        'addedFilesUnchecked' in answer && answer.addedFilesUnchecked === true,
    }
  }
  /** Asks the reader how the Wiki stands against the source and writes the answer into the label; called by {@link look} when a freshness check is due. @param generation - The generation of site and source the check is for; a check already in flight for it is joined instead of asked twice. @returns A promise that settles when the answer was taken in, or dropped because a newer check was started meanwhile. @example await readFreshness('1759491000000|0') // the freshness label shows what the reader answered */
  const readFreshness = (generation: string): Promise<void> => {
    if (freshnessRead?.generation === generation) return freshnessRead.done
    freshnessReadCount += 1
    const readNumber = freshnessReadCount
    const done = (async (): Promise<void> => {
      let answered: AnsweredFreshness | undefined
      try {
        const answer = await readFromReader(settings.freshnessRoute)
        answered = takeFreshnessAnswer(answer)
      } catch {
        answered = undefined
      }
      // A newer check was started for a newer site or source; this late answer must not put its label back over that one's.
      if (readNumber !== freshnessReadCount) return
      freshnessRead = undefined
      if (!answered) {
        noteFreshness(undefined, '', false)
        return
      }
      freshnessGeneration = generation
      freshnessAnsweredAtMs = Date.now()
      noteFreshness(
        answered.status,
        answered.reason,
        answered.isAdditionUnchecked,
      )
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
      // A run that is active is what the press waits for, also when it is the very answer the press started from: after lost contact the link was free during a run.
      if (answerText !== answerAtPress || answer.state === 'running')
        isAwaitingStart = false
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

  /** Tells whether a result that says the Wiki matches the source is out of date; called by {@link describeAnsweredRun} before it words the result. @param state - The state of the last answer. @returns true when the run succeeded or found the Wiki current and the source changed since, false otherwise. @example isOvertakenBySource('succeeded') // => true while the freshness label reads "Source changed · Update available" */
  const isOvertakenBySource = (state: WikiUpdateStatus['state']): boolean =>
    (state === 'succeeded' || state === 'already-current') &&
    freshness === 'changed'
  /** Tells whether the site on disk was published after a run ended; called by {@link describeEndOnCurrentSource}. @param ended - The run's end, of which only `finishedAt` is read, and only once a publish time is known. @returns true when the reader answered a publish time later than the end, false when it is not later or no manifest is readable. @example wasPublishedAfter({ finishedAt: '2026-10-03T12:10:00.000Z' }) // => true when the site was published at 12:20 */
  const wasPublishedAfter = (ended: { finishedAt: string }): boolean =>
    sitePublishedAtMs !== undefined &&
    sitePublishedAtMs > Date.parse(ended.finishedAt)
  /** Words a run that ended without success while the source matches the site again; called by {@link weighUnsuccessfulEnd}. @param ended - The ended run: when it finished and what it left of the site. @param state - The state of that run. @param described - The sentence of that end as {@link WikiUpdatePageSettings.describeUpdate} wrote it. @returns The late-publish sentence when a site was published after the end, undefined when a failed run replaced the site (the status line then says nothing), otherwise the sentence of the end. @example describeEndOnCurrentSource({ finishedAt: '2026-10-03T12:10:00.000Z', site: 'kept' }, 'cancelled', described) // => { state: 'late-publish', lead: 'A new site was published', … } when the site was published at 12:20 */
  const describeEndOnCurrentSource = (
    ended: { finishedAt: string; site?: string },
    state: WikiUpdateStatus['state'],
    described: WikiUpdateDescription,
  ): Shown | undefined => {
    // The editor chat may publish after its run was given up; the site on disk then matches the source after all.
    if (wasPublishedAfter(ended))
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
    if (state === 'failed' && ended.site === 'replaced') return undefined
    return { state, ...described }
  }
  /** Weighs the sentence of the last answer against a source that is current; called by {@link describeAnsweredRun} for every answer it words. @param answer - The last answer of the reader. @param state - Its state. @param described - Its sentence. @returns What {@link describeEndOnCurrentSource} says for a run that ended without success while freshness is current, otherwise the sentence with its state. @example weighUnsuccessfulEnd({ state: 'running', … }, 'running', described) // => { state: 'running', ...described } */
  const weighUnsuccessfulEnd = (
    answer: WikiUpdateStatus,
    state: WikiUpdateStatus['state'],
    described: WikiUpdateDescription,
  ): Shown | undefined => {
    if (
      isEndedWithoutSuccess(state) &&
      'finishedAt' in answer &&
      freshness === 'current'
    )
      return describeEndOnCurrentSource(answer, state, described)
    return { state, ...described }
  }
  /** Words the last answer of the reader and weighs it against freshness; called by {@link describeShown} when the page itself has nothing to say. @returns The sentence to show, or undefined before the first answer, for a state without a sentence, and for a result that freshness has overtaken. @example describeAnsweredRun() // => { state: 'running', lead: 'Updating', … } while a run is active */
  const describeAnsweredRun = (): Shown | undefined => {
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
    if (isOvertakenBySource(state)) return undefined
    return weighUnsuccessfulEnd(lastAnswer, state, described)
  }
  /** Decides what the status line says from everything the page knows; called by {@link show} on every look and press. @returns The sentence of the page's own state (lost contact, awaiting the confirmation, no start), else what {@link describeAnsweredRun} says, which is undefined when the line stays empty. @example describeShown() // => { state: 'awaiting', lead: 'Confirm the update in your editor', rest: ' to start it.', detail: [], output: '', offerReload: false } right after a press */
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
    return describeAnsweredRun()
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
    // The mark swaps the two buttons' looks for as long as the reload is offered.
    if (shown?.offerReload)
      group.setAttribute('data-codebook-reload-offered', '')
    else group.removeAttribute('data-codebook-reload-offered')
    if (!shown) {
      statusRegion.replaceChildren()
      statusRegion.removeAttribute('data-state')
      return
    }
    const lead = document.createElement('strong')
    lead.textContent = shown.lead
    // The controls after the region are not announced with it, so the announced sentence ends with a clause that names them.
    let followClause = ''
    if (shown.offerReload) followClause = ' Reload is offered below.'
    else if (shown.detail.length > 0)
      followClause =
        shown.state === 'conflict'
          ? ' The full list is below.'
          : ' The full message is below.'
    // The clause's element is made anew and goes in with the sentence, so the region changes once per sentence.
    const followNote = document.createElement('span')
    followNote.setAttribute('data-codebook-update-note', '')
    followNote.textContent = followClause
    statusRegion.replaceChildren(
      lead,
      shown.rest,
      ...(followClause ? [followNote] : []),
    )
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
