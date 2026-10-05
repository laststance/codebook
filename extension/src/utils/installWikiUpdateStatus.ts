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
  /** The chat request of the publisher's recovery, handed to the embedded sentence writer like the minute length. */
  recoveryRequest: string
  /** Why VS Code's chat asks to approve each step of an update whose output lies outside the project, handed to the embedded sentence writer like the recovery request, so the running line says what the editor says. */
  outsideOutputApprovalsNote: string
  /** How long after the window's `load` event the line that says the overview stands in for a missing page gets its sentence (ms); the line is in the page, empty, before that. */
  missingPageTextDelayMs: number
  /** How many characters of the missing page's path that line shows at most; a longer value of the address gets the sentence without the path. */
  missingPagePathLimitChars: number
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
 *   recoveryRequest: '/codebook Recover the unfinished LLM Wiki publish for this project',
 *   outsideOutputApprovalsNote: 'This Wiki’s output lies outside the project, so the chat will ask to approve each step there; an output inside the project (codebook.wikiOutputDirectory) needs none.',
 *   missingPageTextDelayMs: 150,
 *   missingPagePathLimitChars: 200,
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
    // The entry that opens the page's first cited source is an unfilled block: its fill and border answer the pointer, a press darkens it, and its focus ring lies inside it, because the rail scrolls and cuts a ring outside. No transition.
    '.open-in-editor a{display:block;border:1px solid var(--border,#777);border-radius:6px;padding:.5rem .7rem;text-decoration:none;font-size:.8rem;overflow-wrap:anywhere}',
    '.open-in-editor a:hover{background:var(--panel-2,Canvas);border-color:var(--link,LinkText)}',
    '.open-in-editor a:active{background:var(--panel-2,Canvas);border-color:var(--link,LinkText);filter:brightness(.9)}',
    '.open-in-editor a:focus-visible{outline:2px solid var(--link,LinkText);outline-offset:-2px}',
    // Its label keeps one line and the file and line it opens wrap under it; the reader adds that target to a site published before the entry named it.
    '.open-label{display:block;white-space:nowrap}',
    '.open-target{display:block;margin-top:.15rem;font-size:.75rem;line-height:1.45;color:var(--muted,GrayText);overflow-wrap:anywhere}',
    // The chapter list and the outline scroll, so the focus ring of their full-width links lies inside the link; the rail keeps room at its left for the ring of the link that changes the output location.
    '.chapters a:focus-visible,.right-rail nav a:focus-visible{outline-offset:-2px}',
    '.right-rail{padding-left:5px;margin-left:-5px}',
    // Where the rail is a row below the article (701 to 1000 px) the rail itself has no cap and no scrollbar: the outline and an open detail scroll inside their own bounds, and the update panel keeps a wide column and its own height, so its sentence is never cut. The target adds no width to its entry.
    '@media(min-width:701px) and (max-width:1000px){.right-rail{max-height:none;overflow:visible}.right-rail nav{flex:1 1 10rem;min-width:10rem;max-height:10rem;overflow:auto;overflow-wrap:anywhere}[data-codebook-update-detail][open]{max-height:6rem;overflow:auto}[data-codebook-update-group]{flex:0 1 28rem;min-width:0;align-self:flex-start}.right-rail .open-target{width:0;min-width:100%}}',
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
    // Until its sentence arrives the line shows no box, so it can be in the accessibility tree from the start.
    '[data-codebook-missing-page]:empty{margin:0;padding:0;border:0}',
  ].join('')
  document.head.append(styles)

  /** Tells whether a text is a relative path as the publisher allows them: no leading slash, no backslash, control character, `?`, `#` or `:`, and no empty, `.` or `..` part; asked by {@link isShownPagePath}. @param value - The text to judge. @returns true for such a path, false for anything else. @example isRelativePath('pages/removed.html') // => true; isRelativePath('../../etc/passwd.html') // => false */
  const isRelativePath = (value: string): boolean =>
    !value.startsWith('/') &&
    !/[\\\x00-\x1f?#:]/.test(value) &&
    value.split('/').every((part) => !['', '.', '..'].includes(part))
  /** Tells whether the `missing` value of the address may be shown as a page path; asked by {@link missingPageSentence}, because anyone can write the address. @param value - The value of `missing` as the address carries it. @returns true for a relative path of an HTML page that is no longer than the path limit, false for anything else. @example isShownPagePath('pages/removed.html') // => true; isShownPagePath('pages/notes.txt') // => false */
  const isShownPagePath = (value: string): boolean =>
    value.length <= settings.missingPagePathLimitChars &&
    value.endsWith('.html') &&
    isRelativePath(value)
  /** Words the line that says the overview stands in for a missing page; called by {@link announceMissingPage}. @param missingPage - The value of `missing` in the address. @returns The sentence with the page's path when {@link isShownPagePath} allows it, otherwise the sentence that names no path. @example missingPageSentence('pages/removed.html') // => 'The page pages/removed.html is not in this Wiki. The last update may have removed it. This is the overview.' */
  const missingPageSentence = (missingPage: string): string =>
    (isShownPagePath(missingPage)
      ? 'The page ' + missingPage + ' is not in this Wiki.'
      : 'The page you asked for is not in this Wiki.') +
    ' The last update may have removed it. This is the overview.'
  /** Runs a step once the window has loaded: at once on a page that already has, otherwise at its `load` event; called by {@link announceMissingPage}, whose sentence must not arrive while the page itself is still being read out. @param step - What to do then. @returns Nothing. @example afterWindowLoad(() => { window.setTimeout(writeSentence, 150) }) */
  const afterWindowLoad = (step: () => void): void => {
    if (document.readyState === 'complete') step()
    else window.addEventListener('load', step, { once: true })
  }
  /** Says that the overview is shown in place of a page the Wiki does not have: an empty status line above the article that gets its sentence after the load, and the notice in front of the document title at once. Called once per page load when the address names a missing page. @param missingPage - The value of `missing` in the address. @returns Nothing; the keyboard focus is not moved. @example announceMissingPage('pages/removed.html') // the title reads "Page not in this Wiki · Overview · sample DeepWiki" at once, the line gets its sentence 150 ms after the load */
  const announceMissingPage = (missingPage: string): void => {
    const missingLine = document.createElement('p')
    missingLine.setAttribute('data-codebook-missing-page', '')
    missingLine.setAttribute('role', 'status')
    // The learner's eye lands on the article, so the line is the first element of the reading column, above the title. It goes in empty: a status region is announced when its text changes, not when it appears with its text.
    const readingColumn =
      document.querySelector<HTMLElement>('.reading-column') ?? document.body
    readingColumn.insertBefore(missingLine, readingColumn.firstChild)
    // The title is what every screen reader reads when a page loads and what the tab shows, so it carries the notice with certainty.
    document.title = 'Page not in this Wiki · ' + document.title
    const sentence = missingPageSentence(missingPage)
    // A timer and not an animation frame: a frame does not run in a background tab, and one frame is too short for the empty region to be registered first.
    afterWindowLoad(() => {
      window.setTimeout(() => {
        missingLine.textContent = sentence
      }, settings.missingPageTextDelayMs)
    })
  }
  // The reader sends a request for a page the Wiki does not have to the overview and names that page in the address.
  const addressQuery = new URLSearchParams(location.search)
  const missingPage = addressQuery.get('missing')
  if (missingPage !== null) {
    announceMissingPage(missingPage)
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

  /** Tells whether the last answer of the reader was a run in progress; asked by {@link noteAnswer} before it takes in the next answer, by {@link noteFailedRead} and by {@link nextLookDelayMs}. @returns true while the last answered state is "running", false for any other state and before the first answer. @example isRunLastAnswered() // => true between the answer that began a run and the one that ended it */
  const isRunLastAnswered = (): boolean => lastAnswer?.state === 'running'
  /** Tells whether an answer ends the wait a press of the update link began; asked by {@link weighAnswerAgainstPress} once the answer at the press is known. @param answer - The answer just read. @param answerText - Its serialized form. @returns true when the answer differs from the one the press started from or names a run in progress, false while the reader still answers what it answered at the press. @example isPressAnswered({ state: 'running', … }, answerText) // => true */
  const isPressAnswered = (
    answer: WikiUpdateStatus,
    answerText: string,
  ): boolean => answerText !== answerAtPress || answer.state === 'running'
  /** Weighs one answer against the press of the update link the page still waits for; called by {@link noteAnswer} while that wait lasts. @param answer - The answer just read. @param answerText - Its serialized form. @returns Nothing; the wait ends when the answer changed or a run is active, and ends as "no update started" once the start wait passed. @example weighAnswerAgainstPress({ state: 'idle' }, '{"state":"idle"}') // the page says "No update started." 120 s after the press */
  const weighAnswerAgainstPress = (
    answer: WikiUpdateStatus,
    answerText: string,
  ): void => {
    // A press before the first answer takes that answer as its starting point.
    answerAtPress ??= answerText
    // A run that is active is what the press waits for, also when it is the very answer the press started from: after lost contact the link was free during a run.
    if (isPressAnswered(answer, answerText)) isAwaitingStart = false
    else if (Date.now() >= awaitingStartUntilMs) {
      isAwaitingStart = false
      didStartWaitPass = true
    }
  }
  /** Takes in one answer of `api/update-status`; called by {@link look} for every answer that names a state. @param answer - The answered run state, without the site's publish time, publication and source stamp. @returns Whether the run it describes just ended: true when the answer before it was a run in progress and this one is not. @example noteAnswer({ state: 'succeeded', … }) // => true right after a run */
  const noteAnswer = (answer: WikiUpdateStatus): boolean => {
    const answerText = JSON.stringify(answer)
    const didRunEnd = isRunLastAnswered() && answer.state !== 'running'
    failedReadCount = 0
    isUnreachable = false
    if (isAwaitingStart) weighAnswerAgainstPress(answer, answerText)
    else if (answerText !== lastAnswerText) didStartWaitPass = false
    lastAnswer = answer
    lastAnswerText = answerText
    return didRunEnd
  }

  /** Takes in a read the reader did not answer; called by {@link look} when its request failed or its answer named no state. @returns Nothing; the page gives up on its reader when its status line says something and either no run is in progress or the run lost more reads than the retry limit. @example noteFailedRead() // the status line then says "Lost contact with the editor" once a shown result's reader is gone */
  const noteFailedRead = (): void => {
    failedReadCount += 1
    // A run in progress outlives a few lost reads before the page gives up on it.
    if (isRunLastAnswered() && failedReadCount <= settings.statusRetryLimit)
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
  /** Tells whether the site on disk was published after a run ended; called by {@link weighUnsuccessfulEnd}. @param ended - The run's end, of which only `finishedAt` is read, and only once a publish time is known. @returns true when the reader answered a publish time later than the end, false when it is not later or no manifest is readable. @example wasPublishedAfter({ finishedAt: '2026-10-03T12:10:00.000Z' }) // => true when the site was published at 12:20 */
  const wasPublishedAfter = (ended: { finishedAt: string }): boolean =>
    sitePublishedAtMs !== undefined &&
    sitePublishedAtMs > Date.parse(ended.finishedAt)
  /** Words a publish that landed after a run was given up; called by {@link weighUnsuccessfulEnd} whatever the freshness check answered. @param output - The output line of the ended run. @returns The late-publish sentence: "… and matches the source." while freshness is current, otherwise a pointer to the freshness label, which says how the new site stands; a reload is offered when the page was served from another publication. @example describeLatePublish('Output: .codebook/wiki') // => { state: 'late-publish', lead: 'A new site was published', rest: ' after this run ended and matches the source.', … } */
  const describeLatePublish = (output: string): Shown => ({
    state: 'late-publish',
    lead: 'A new site was published',
    rest:
      freshness === 'current'
        ? ' after this run ended and matches the source.'
        : ' after this run ended; check the freshness label above.',
    detail: [],
    output,
    // Only a page served before that publish still shows the older pages.
    offerReload: sitePublication !== settings.pagePublication,
  })
  /** Words a run that ended without success and was followed by no publish; called by {@link weighUnsuccessfulEnd}. @param ended - The ended run, of which only what it left of the site is read. @param state - The state of that run. @param described - The sentence of that end as {@link WikiUpdatePageSettings.describeUpdate} wrote it. @returns undefined when a failed run replaced the site and the source matches it again (the status line then says nothing), otherwise the sentence of the end. @example describeEndWithoutPublish({ finishedAt: '2026-10-03T12:10:00.000Z', site: 'kept' }, 'cancelled', described) // => { state: 'cancelled', ...described } */
  const describeEndWithoutPublish = (
    ended: { finishedAt: string; site?: string },
    state: WikiUpdateStatus['state'],
    described: WikiUpdateDescription,
  ): Shown | undefined => {
    // Nothing was published since, so the source itself went back to what the site describes: "needs another run" no longer holds.
    if (
      freshness === 'current' &&
      state === 'failed' &&
      ended.site === 'replaced'
    )
      return undefined
    return { state, ...described }
  }
  /** Weighs the sentence of the last answer against what happened since the run ended; called by {@link describeAnsweredRun} for every answer it words. @param answer - The last answer of the reader. @param state - Its state. @param described - Its sentence. @returns For a run that ended without success: the late-publish sentence of {@link describeLatePublish} when a site was published after the end, whatever freshness answers, otherwise what {@link describeEndWithoutPublish} says; for every other answer the sentence with its state. @example weighUnsuccessfulEnd({ state: 'running', … }, 'running', described) // => { state: 'running', ...described } */
  const weighUnsuccessfulEnd = (
    answer: WikiUpdateStatus,
    state: WikiUpdateStatus['state'],
    described: WikiUpdateDescription,
  ): Shown | undefined => {
    if (!isEndedWithoutSuccess(state) || !('finishedAt' in answer))
      return { state, ...described }
    // The editor chat may publish after its run was given up; the page then shows an older site than the reader answers, also when that site does not match the source.
    if (wasPublishedAfter(answer)) return describeLatePublish(described.output)
    return describeEndWithoutPublish(answer, state, described)
  }
  /** Words the last answer of the reader and weighs it against freshness; called by {@link describeShown} when the page itself has nothing to say. @returns The sentence to show, or undefined before the first answer, for a state without a sentence, and for a result that freshness has overtaken. @example describeAnsweredRun() // => { state: 'running', lead: 'Updating', … } while a run is active */
  const describeAnsweredRun = (): Shown | undefined => {
    if (!lastAnswer) return undefined
    const described = settings.describeUpdate(lastAnswer, {
      formatTime,
      pathLimit: settings.pathLimit,
      reasonLimitChars: settings.reasonLimitChars,
      msPerMinute: settings.msPerMinute,
      recoveryRequest: settings.recoveryRequest,
      outsideOutputApprovalsNote: settings.outsideOutputApprovalsNote,
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
  /** Chooses the text of the update link; asked by {@link showUpdateLink} before it compares the link's text. @param isRunning - Whether a run is active. @returns "Updating…" while a run is active, otherwise the label the page was published with. @example updateLinkText(false) // => 'Update LLM Wiki' */
  const updateLinkText = (isRunning: boolean): string =>
    isRunning ? 'Updating…' : updateLinkLabel
  /** Sets an attribute only when its value differs, so an unchanged look writes nothing: a browser's observers see every `setAttribute`, also one that sets the value the attribute already has. Called by {@link showUpdateLink} on every look while a run is active. @param element - The element to write. @param name - The attribute's name. @param value - The value it must have. @returns Nothing. @example setAttributeIfChanged(link, 'aria-disabled', 'true') // writes once; the second call changes nothing */
  const setAttributeIfChanged = (
    element: HTMLElement,
    name: string,
    value: string,
  ): void => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value)
  }
  /** Holds the update link back while a run is active; it stays a focusable link, and its label and the status line say why. Called by {@link show} on every look and press; it writes an attribute only when its value changes. @param isRunning - Whether the sentence on the page is that of a run in progress. @returns Nothing; a page without the link is left alone. @example showUpdateLink(true) // the link reads "Updating…" and is `aria-disabled` */
  const showUpdateLink = (isRunning: boolean): void => {
    if (!updateLink) return
    const label = updateLinkText(isRunning)
    if (updateLink.textContent !== label) updateLink.textContent = label
    if (isRunning) {
      setAttributeIfChanged(updateLink, 'aria-disabled', 'true')
      setAttributeIfChanged(updateLink, 'aria-describedby', statusRegion.id)
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

  /** Chooses how long the page waits before it asks the reader again; asked by {@link scheduleNextLook} before it sets its timer. @returns The status poll interval while a press awaits its run or a run is active on a reader that answers, otherwise the idle poll interval. @example nextLookDelayMs() // => 2000 while a run is active, 15000 while nothing runs */
  const nextLookDelayMs = (): number =>
    isAwaitingStart || (isRunLastAnswered() && !isUnreachable)
      ? settings.statusPollMs
      : settings.idlePollMs
  /** Sets the one timer of the next look, replacing the pending one; called by {@link look} after it showed an answer and by the press of the update link. @returns Nothing; a hidden tab gets no timer. @example scheduleNextLook() // the reader is asked again in 2 s during a run */
  const scheduleNextLook = (): void => {
    window.clearTimeout(pollTimer)
    // A hidden tab keeps no timer; showing it again looks at once.
    if (document.hidden) return
    const delayMs = nextLookDelayMs()
    pollTimer = window.setTimeout(() => {
      void look(false)
    }, delayMs)
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
  // The look the last return to the page started and the event that started it, while that look is under way.
  let returnLook:
    { event: 'visibilitychange' | 'focus'; done: Promise<void> } | undefined
  /** Looks once when the learner comes back to the page; called by the tab's `visibilitychange` and the window's `focus`, which a browser fires together for one return to the tab. The other event of the same return, arriving while the first one's look is under way, joins that look instead of asking the reader again; the same event again is a new return. @param event - The event that reports the return. @example lookOnReturn('focus') // asks the reader, unless the look of this return's visibilitychange is still under way */
  const lookOnReturn = (event: 'visibilitychange' | 'focus'): void => {
    if (returnLook && returnLook.event !== event) return
    const started = { event, done: look(true) }
    returnLook = started
    void started.done.finally(() => {
      if (returnLook === started) returnLook = undefined
    })
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.clearTimeout(pollTimer)
    else lookOnReturn('visibilitychange')
  })
  // A window beside the editor never becomes hidden; focus is when the learner comes back to it.
  window.addEventListener('focus', () => {
    lookOnReturn('focus')
  })
  void look(true)
}
