import type { WikiUpdateStatus } from './wikiUpdateRun'

/** What the learner reads for one update state: the lead words that carry the state, the rest of the sentence, anything shortened in it, and the output line. */
export type WikiUpdateDescription = {
  /** State words shown strong, for example "Updated" or "Update failed". */
  lead: string
  /** Remainder of the text; `lead + rest` is the whole sentence. */
  rest: string
  /** Full conflict paths or the full reason when `rest` shortened them; empty otherwise. */
  detail: string[]
  /** The output line, for example "Output: .codebook/wiki". */
  output: string
  /** Whether the reading page shows an older publication than this result and should offer a reload. */
  offerReload: boolean
}

/** How {@link describeWikiUpdate} formats and bounds its text. */
export type WikiUpdateWording = {
  /** Turns an ISO timestamp into the learner's local hour and minute. */
  formatTime: (isoTimestamp: string) => string
  /** How many conflict paths the sentence names before "and N more". */
  pathLimit: number
  /** How many characters of a failure reason the sentence shows; a reason Codebook wrote itself (`isCodebookSentence`) is never shortened. */
  reasonLimitChars: number
  /** Milliseconds in one minute, for naming a bound in minutes; the function is embedded into the page and cannot import the constant. */
  msPerMinute: number
  /** The chat request that makes the editor agent run the publisher's recovery, as the learner pastes it ({@link WIKI_UPDATE_RECOVERY_REQUEST}); the function is embedded into the page and cannot import the constant. */
  recoveryRequest: string
  /** Why VS Code's chat asks to approve each step of an update whose output lies outside the project, as the editor's confirmation says it ({@link WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE}); the function is embedded into the page and cannot import the constant. */
  outsideOutputApprovalsNote: string
  /** What a learner does after they refused a step of VS Code's chat ({@link WIKI_REFUSED_STEP_ADVICE}), without its full stop; the running line of a VS Code update goes on from it with where Cancel is and what happens otherwise. The function is embedded into the page and cannot import the constant. */
  refusedStepAdvice: string
  /** Where the reader finds the freshness label, as the end of "check the freshness label …": `above` on the page, `in the browser reader` in an editor notification. */
  freshnessLabelPlace: string
  /** Whether the reading page was served from another publication than the one on disk now; omitted by the editor, which never offers a reload. */
  isPageOlderThanSite?: boolean
}

/** One update state of {@link WikiUpdateStatus} by its name, as the helpers nested in {@link describeWikiUpdate} take it; a type only, so the embedded function stays free of outer variables. */
type WikiUpdateStatusOf<State extends WikiUpdateStatus['state']> = Extract<
  WikiUpdateStatus,
  { state: State }
>

/**
 * Writes what the browser Wiki and the editor notification say for one update state.
 *
 * Why: page and editor must say the same thing, say whether the site was kept or replaced, and name the next step. The function is embedded into the served page script with `toString()`, so it must stay free of imports and outer variables.
 * Trigger: the reader page calls it with each `api/update-status` answer; the editor calls it when a run ends.
 *
 * @param status - Update run state from the extension.
 * @param wording - Time format, the bounds of the sentence, the minute length, the recovery request, the note on approvals outside the project, where the freshness label is and whether the reading page is older than the site.
 * @returns
 * - Idle: undefined (nothing to show)
 * - A state this version does not know: "Update status unknown.", with the output line only when that state names an output; none of its other fields is read
 * - Otherwise: the lead words, the rest of the sentence, shortened detail and the output line
 *
 * @example
 * ```ts
 * describeWikiUpdate(
 *   { state: 'cancelled', host: 'cursor', finishedAt: '2026-10-03T12:10:00.000Z', site: 'kept', outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' },
 *   { formatTime: () => '21:10', pathLimit: 3, reasonLimitChars: 200, msPerMinute: 60_000, recoveryRequest: '/codebook Recover the unfinished LLM Wiki publish for this project', outsideOutputApprovalsNote: 'This Wiki’s output lies outside the project, so the chat will ask to approve each step there; an output inside the project (codebook.wikiOutputDirectory) needs none.', refusedStepAdvice: 'If you refuse a step of the chat, press Cancel', freshnessLabelPlace: 'above' },
 * )
 * // => { lead: 'Update cancelled', rest: ' at 21:10. Cursor Agent was stopped. The last usable site is kept.', detail: [], output: 'Output: .codebook/wiki', offerReload: false }
 * ```
 */
export function describeWikiUpdate(
  status: WikiUpdateStatus,
  wording: WikiUpdateWording,
): WikiUpdateDescription | undefined {
  if (status.state === 'idle') return undefined
  /**
   * Words the output line of a state; called once by {@link describeWikiUpdate}, before anything else of the state is read.
   * @param place - The label and the folder the state names; a state of a newer extension may name neither.
   * @returns "Output: " with the label, or with the folder when the label is empty; an empty line when the state names no output, instead of "Output: undefined".
   * @example outputLineOf({ outputLabel: '.codebook/wiki', outputDirectory: '/repo/.codebook/wiki' }) // => 'Output: .codebook/wiki'
   */
  const outputLineOf = (place: {
    outputLabel?: string
    outputDirectory?: string
  }): string => {
    const shownPlace = place.outputLabel || place.outputDirectory
    return shownPlace ? 'Output: ' + shownPlace : ''
  }
  const output = outputLineOf(status)
  const describe = (
    lead: string,
    rest: string,
    detail: string[] = [],
    offerReload = false,
  ): WikiUpdateDescription => ({ lead, rest, detail, output, offerReload })
  const minutes = (durationMs: number): string => {
    const count = Math.round(durationMs / wording.msPerMinute)
    return count + (count === 1 ? ' minute' : ' minutes')
  }
  // The step that names the publisher's recovery request, after the first letter of "Ask" or "ask"; the request is the caller's, so page, notice and failure reasons name one request.
  const recoveryStep =
    'sk the editor chat "' +
    wording.recoveryRequest +
    '", then press Update LLM Wiki again.'
  const freshnessStep =
    'check the freshness label ' + wording.freshnessLabelPlace + '.'
  /**
   * Words the running line of a Cursor update; called by {@link describeRunning}.
   * @param running - The running state.
   * @param since - When the run started, as the learner's local time.
   * @param bound - The run's bound in whole minutes, for example "15 minutes".
   * @returns The description: preparing a new site once a candidate is staged, started and bounded before that.
   * @example describeRunningInCursor(running, '21:00', '15 minutes').lead // => 'Updating LLM Wiki…'
   */
  const describeRunningInCursor = (
    running: WikiUpdateStatusOf<'running'>,
    since: string,
    bound: string,
  ): WikiUpdateDescription =>
    describe(
      'Updating LLM Wiki…',
      (running.candidateStaged
        ? ' Cursor Agent is preparing a new site (started ' +
          since +
          ', up to ' +
          bound +
          ').'
        : ' Cursor Agent started at ' +
          since +
          ' and may take up to ' +
          bound +
          '.') +
        ' Cancel it from the notification in Cursor. This site stays readable.',
    )
  /**
   * Words the running line of a VS Code update, whose request went to the chat; called by {@link describeRunning}.
   * @param running - The running state.
   * @param since - When the request was sent, as the learner's local time.
   * @param bound - The watch's bound in whole minutes, for example "15 minutes".
   * @returns The description: the chat is preparing a new site once a candidate is staged, the request and where to follow it before that; an output outside the project adds why the chat asks to approve each step; the line ends with what to do after a refused step, which the editor's short notification does not say.
   * @example describeRunningInVsCode(running, '21:00', '15 minutes').lead // => 'Updating LLM Wiki…'
   */
  const describeRunningInVsCode = (
    running: WikiUpdateStatusOf<'running'>,
    since: string,
    bound: string,
  ): WikiUpdateDescription =>
    describe(
      'Updating LLM Wiki…',
      (running.candidateStaged
        ? ' The VS Code chat is preparing a new site (request sent ' +
          since +
          '). Approve the steps it asks for. Codebook watches for the publish for up to '
        : ' The request went to the VS Code chat at ' +
          since +
          '. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to ') +
        bound +
        '. This site stays readable.' +
        // The chat asks for each step outside the workspace; the learner should know why and how to avoid it.
        (running.isOutputOutsideProject
          ? ' ' + wording.outsideOutputApprovalsNote
          : '') +
        // Once the chat asked for an approval Codebook does not see it stop: a learner who refused a step and stays on this page would wait out the bound.
        ' ' +
        wording.refusedStepAdvice +
        ' in the editor’s notification; otherwise Codebook keeps watching for the whole ' +
        bound +
        '.',
    )
  /**
   * Words a run that is still under way, by its host; called by {@link describeWikiUpdate} for the state `running`.
   * @param running - The running state.
   * @returns The description of {@link describeRunningInCursor} for Cursor, of {@link describeRunningInVsCode} otherwise.
   * @example describeRunning(running).lead // => 'Updating LLM Wiki…'
   */
  const describeRunning = (
    running: WikiUpdateStatusOf<'running'>,
  ): WikiUpdateDescription => {
    const since = wording.formatTime(running.startedAt)
    const bound = minutes(running.timeoutMs)
    if (running.host === 'cursor')
      return describeRunningInCursor(running, since, bound)
    return describeRunningInVsCode(running, since, bound)
  }
  /**
   * Words a successful update with what it was checked against; called by {@link describeEnded} for the state `succeeded`.
   * @param succeeded - The succeeded state.
   * @param at - When the run ended, as the learner's local time.
   * @returns The description, with the revision when one was recorded and with the reload offer when the reading page is older than the site.
   * @example describeSucceeded(succeeded, '21:10').rest // => ' at 21:10 to revision a1b2c3d4e5f6 (index 0f9e8d7c).'
   */
  const describeSucceeded = (
    succeeded: WikiUpdateStatusOf<'succeeded'>,
    at: string,
  ): WikiUpdateDescription => {
    // The page compares the publication it was served from with the one on disk, never two clocks.
    const offerReload = wording.isPageOlderThanSite === true
    // Without a Git repository no revision was checked, and neither were added files.
    if (succeeded.revision === undefined)
      return describe(
        'Updated',
        ' at ' +
          at +
          ' (index ' +
          succeeded.index +
          '; no Git revision recorded, so added files are not checked).',
        [],
        offerReload,
      )
    return describe(
      'Updated',
      ' at ' +
        at +
        ' to revision ' +
        succeeded.revision +
        ' (index ' +
        succeeded.index +
        ').',
      [],
      offerReload,
    )
  }
  /**
   * Cuts a failure reason at the limit without breaking a word; called by {@link shownReason} for a reason that is too long.
   * @param trimmed - The reason without surrounding white space.
   * @returns The start of the reason up to the last space before the limit (up to the limit when it has none), ended with "…".
   * @example cutBeforeLimit('The agent stopped because of an error') // => 'The agent stopped…' with a limit of 20
   */
  const cutBeforeLimit = (trimmed: string): string => {
    // The cut falls on the last space before the limit, so no word is broken; a reason without one is cut at the limit.
    const lastSpace = trimmed.lastIndexOf(' ', wording.reasonLimitChars)
    return (
      trimmed
        .slice(0, lastSpace > 0 ? lastSpace : wording.reasonLimitChars)
        .trimEnd() + '…'
    )
  }
  /**
   * Bounds a failure reason; called by {@link describeFailed}.
   * @param failed - The failed state.
   * @returns `shown`: the reason as the sentence shows it, whole for a sentence Codebook wrote and cut for a longer text of an agent, the CLI or a thrown error; `detail`: the whole reason when it was cut, empty otherwise.
   * @example shownReason(failed) // => { shown: 'Cursor Agent exited with code 1', detail: [] }
   */
  const shownReason = (
    failed: WikiUpdateStatusOf<'failed'>,
  ): { shown: string; detail: string[] } => {
    const trimmed = failed.reason.trim()
    // A sentence Codebook wrote ends with its next step, so it is shown whole; only an agent's, the CLI's or a thrown error's text is cut.
    const isShortened =
      !failed.isCodebookSentence && trimmed.length > wording.reasonLimitChars
    return {
      shown: isShortened ? cutBeforeLimit(trimmed) : trimmed,
      detail: isShortened ? [trimmed] : [],
    }
  }
  /**
   * Words what a failed update with a kept site says of that site; called by {@link describeFailed} last.
   * @param failed - The failed state.
   * @returns " The last usable site is kept."; " Nothing had been replaced by then." where somebody can still publish after this end (`mayBeReplacedLater`), since the editor keeps the notice on screen and "is kept" would become untrue under it.
   * @example keptSiteClause(failed) // => ' The last usable site is kept.'
   */
  const keptSiteClause = (failed: WikiUpdateStatusOf<'failed'>): string =>
    failed.mayBeReplacedLater
      ? ' Nothing had been replaced by then.'
      : ' The last usable site is kept.'
  /**
   * Words a failed update with its reason and what became of the site; called by {@link describeEnded} for the state `failed`.
   * @param failed - The failed state.
   * @param at - When the run ended, as the learner's local time.
   * @param replaced - Whether the run replaced the site on disk.
   * @returns The description: "Update needs another run" for a replaced site, "Update failed" for a missing or a kept one. A kept site is worded by {@link keptSiteClause}: called kept, unless somebody can still publish after this end.
   * @example describeFailed(failed, '21:10', false).rest // => ' at 21:10: Cursor Agent exited with code 1. The last usable site is kept.'
   */
  const describeFailed = (
    failed: WikiUpdateStatusOf<'failed'>,
    at: string,
    replaced: boolean,
  ): WikiUpdateDescription => {
    const { shown, detail } = shownReason(failed)
    // A reason from a thrown error often has no full stop; it must not run into the next sentence.
    const sentence = /[.!?…]$/.test(shown) ? shown : shown + '.'
    if (replaced)
      return describe(
        'Update needs another run',
        ' (' + at + '): ' + sentence + ' This run replaced the site on disk.',
        detail,
      )
    // A Wiki that is gone was neither kept nor replaced; the reason says what to do.
    if (failed.site === 'missing')
      return describe('Update failed', ' at ' + at + ': ' + sentence, detail)
    return describe(
      'Update failed',
      ' at ' + at + ': ' + sentence + keptSiteClause(failed),
      detail,
    )
  }
  /**
   * Words a stopped update by its host; called by {@link describeStoppedRun} for the state `cancelled`.
   * @param cancelled - The cancelled state.
   * @param at - When the run was stopped, as the learner's local time.
   * @param replaced - Whether the site on disk was replaced before the stop.
   * @returns The description: "Update cancelled" for Cursor, whose agent was stopped; "Stopped watching" for VS Code, whose chat may still publish.
   * @example describeCancelled(cancelled, '21:10', false).rest // => ' at 21:10. Cursor Agent was stopped. The last usable site is kept.'
   */
  const describeCancelled = (
    cancelled: WikiUpdateStatusOf<'cancelled'>,
    at: string,
    replaced: boolean,
  ): WikiUpdateDescription => {
    if (cancelled.host === 'cursor')
      return describe(
        'Update cancelled',
        ' at ' +
          at +
          (replaced
            ? '. Cursor Agent was stopped after it replaced the site on disk; ' +
              freshnessStep
            : '. Cursor Agent was stopped. The last usable site is kept.'),
      )
    return describe(
      'Stopped watching',
      ' at ' +
        at +
        (replaced
          ? '. A new site was published just before; ' + freshnessStep
          : '. The VS Code chat may still be working and can still publish; stop it in the chat to cancel the update itself. Nothing has been replaced so far.'),
    )
  }
  /**
   * Words an update that passed its bound, by its host; called by {@link describeStoppedRun} for the state `timed-out`.
   * @param timedOut - The timed-out state.
   * @param at - When the run was stopped, as the learner's local time.
   * @param replaced - Whether the site on disk was replaced before the stop.
   * @returns The description: "Update timed out" for Cursor, whose agent was stopped, with the bound in minutes and the next step; "No new site appeared" for VS Code, whose chat was not stopped with the watch and can still publish: what held when the watch stopped, in words that stay true after a later publish, and a step for a chat that waits for the learner, one that still works and one that stopped (the press that Codebook refuses while it waits for that chat, and the override the refusal offers).
   * @example describeTimedOut(timedOut, '21:15', false).lead // => 'Update timed out'
   */
  const describeTimedOut = (
    timedOut: WikiUpdateStatusOf<'timed-out'>,
    at: string,
    replaced: boolean,
  ): WikiUpdateDescription => {
    const bound = minutes(timedOut.timeoutMs)
    if (timedOut.host === 'cursor')
      return describe(
        'Update timed out',
        ': Cursor Agent did not finish within ' +
          bound +
          ' and was stopped at ' +
          at +
          (replaced
            ? ' after it replaced the site on disk; ' + freshnessStep
            : '. The last usable site is kept. Press Update LLM Wiki to try again.'),
      )
    return describe(
      'No new site appeared',
      ' within ' +
        bound +
        ', so Codebook stopped watching at ' +
        at +
        (replaced
          ? '. The site on disk changed during the watch; ' + freshnessStep
          : // The editor keeps this notice on screen and the chat goes on: nothing here may say "now", and each state the chat can be in gets a step that works (a press is refused while Codebook waits for that chat).
            '. Nothing had been replaced by then. Check the VS Code chat: answer it if it waits for you; let it finish if it is still working (it can still publish, and the Wiki page says when it has). If it stopped or reported a problem, press Update LLM Wiki, then Update anyway in the editor’s notification if Codebook still waits for that chat.'),
    )
  }
  /**
   * Bounds the conflict paths a sentence names; called by {@link describeConflict}.
   * @param paths - The paths of the conflict.
   * @returns `named`: the first paths up to the limit, joined, with "and N more" for the rest; `detail`: a copy of all paths when some were left out, empty otherwise.
   * @example shownPaths(['a.md', 'b.md', 'c.md', 'd.md']) // => { named: 'a.md, b.md, c.md and 1 more', detail: ['a.md', 'b.md', 'c.md', 'd.md'] } with a limit of 3
   */
  const shownPaths = (paths: string[]): { named: string; detail: string[] } => {
    const isShortened = paths.length > wording.pathLimit
    return {
      named:
        paths.slice(0, wording.pathLimit).join(', ') +
        (isShortened
          ? ' and ' + (paths.length - wording.pathLimit) + ' more'
          : ''),
      detail: isShortened ? paths.slice() : [],
    }
  }
  /**
   * Words why generated pages edited by hand keep an update from starting; called by {@link describePageRefusal}.
   * @param named - The paths as the sentence names them.
   * @param many - Whether more than one path is in the way.
   * @returns The sentence after the time, with the next step.
   * @example describeEditedPages('index.md', false) // => 'a generated page was edited by hand (index.md), and the publisher will not overwrite it. Move your change aside or restore the page, then press Update LLM Wiki again.'
   */
  const describeEditedPages = (named: string, many: boolean): string =>
    (many ? 'generated pages were' : 'a generated page was') +
    ' edited by hand (' +
    named +
    '), and the publisher will not overwrite ' +
    (many ? 'them' : 'it') +
    '. Move your change aside or restore the ' +
    (many ? 'pages' : 'page') +
    ', then press Update LLM Wiki again.'
  /**
   * Words why missing generated pages keep an update from starting; called by {@link describePageRefusal}.
   * @param named - The paths as the sentence names them.
   * @param many - Whether more than one path is missing.
   * @returns The sentence after the time, with the next step.
   * @example describeMissingPages('index.md', false).slice(0, 44) // => 'a generated page is missing (index.md). Resto'
   */
  const describeMissingPages = (named: string, many: boolean): string =>
    (many ? 'generated pages are' : 'a generated page is') +
    ' missing (' +
    named +
    '). Restore ' +
    (many ? 'them' : 'it') +
    ' from Git or the editor’s local history; if you cannot, move the Wiki folder aside and ask the editor chat "/codebook Generate the LLM Wiki for this project".'
  /**
   * Words why links or special files in the Wiki folder keep an update from starting; called by {@link describePageRefusal}.
   * @param named - The paths as the sentence names them.
   * @param many - Whether more than one path is in the way.
   * @returns The sentence after the time, with the next step.
   * @example describeSpecialFiles('link.md', false) // => 'the Wiki folder holds a link or special file (link.md), which the publisher refuses. Move it out of the Wiki folder, then press Update LLM Wiki again.'
   */
  const describeSpecialFiles = (named: string, many: boolean): string =>
    'the Wiki folder holds ' +
    (many ? 'links or special files' : 'a link or special file') +
    ' (' +
    named +
    '), which the publisher refuses. Move ' +
    (many ? 'them' : 'it') +
    ' out of the Wiki folder, then press Update LLM Wiki again.'
  /**
   * Words a start refused because of the Wiki's own pages or files; called by {@link describeConflict} before {@link describeRecoveryRefusal}.
   * @param cause - The cause of the conflict.
   * @param named - The paths as the sentence names them.
   * @param many - Whether more than one path is in the way.
   * @returns The sentence after the time for `edited-page`, `missing-page` and `special-file`; undefined for every other cause.
   * @example describePageRefusal('learner-file', 'notes.md', false) // => undefined
   */
  const describePageRefusal = (
    cause: WikiUpdateStatusOf<'conflict'>['cause'],
    named: string,
    many: boolean,
  ): string | undefined => {
    if (cause === 'edited-page') return describeEditedPages(named, many)
    if (cause === 'missing-page') return describeMissingPages(named, many)
    if (cause === 'special-file') return describeSpecialFiles(named, many)
    return undefined
  }
  /**
   * Words a start refused because the Wiki folder is itself a link or a file; called by {@link describeConflict} between {@link describePageRefusal} and {@link describeRecoveryRefusal}.
   * @param cause - The cause of the conflict.
   * @param named - The Wiki folder's own name, as the sentence names it.
   * @returns The sentence after the time for `not-a-folder`, with the next step; undefined for every other cause.
   * @example describeFolderRefusal('not-a-folder', 'wiki')?.slice(0, 52) // => 'the Wiki folder itself (wiki) is a link or a file, an'
   */
  const describeFolderRefusal = (
    cause: WikiUpdateStatusOf<'conflict'>['cause'],
    named: string,
  ): string | undefined =>
    cause === 'not-a-folder'
      ? 'the Wiki folder itself (' +
        named +
        ') is a link or a file, and the publisher refuses anything there but a folder of its own. Replace it by a real folder (if it is a link to your Wiki, move the Wiki’s files into that folder), then press Update LLM Wiki again.'
      : undefined
  /**
   * Words a start refused because of the Wiki's manifest or an unfinished publish, each ending with the recovery request for the editor chat; called by {@link describeConflict} after {@link describePageRefusal}.
   * @param cause - The cause of the conflict.
   * @param named - The paths as the sentence names them.
   * @returns The sentence after the time for `edited-manifest`, `unreadable-manifest` and `unfinished-publish`; undefined for every other cause.
   * @example describeRecoveryRefusal('unfinished-publish', '.codebook/wiki.staging').slice(0, 60) // => 'an earlier publish did not finish (.codebook/wiki.staging). A'
   */
  const describeRecoveryRefusal = (
    cause: WikiUpdateStatusOf<'conflict'>['cause'],
    named: string,
  ): string | undefined => {
    if (cause === 'edited-manifest')
      return (
        'the Wiki’s manifest (' +
        named +
        ') was changed after it was published, and the publisher will not replace it. Keep a copy of your change, a' +
        recoveryStep
      )
    if (cause === 'unreadable-manifest')
      return (
        'Codebook cannot read the Wiki’s manifest (' +
        named +
        '). A' +
        recoveryStep
      )
    if (cause === 'unfinished-publish')
      return (
        'an earlier publish did not finish (' + named + '). A' + recoveryStep
      )
    return undefined
  }
  /**
   * Words what became of the site when a run stopped before it would overwrite the learner's own files; called by {@link describeConflict} for {@link describeOverwriteStop}.
   * @param replaced - Whether the site on disk changed during the run.
   * @returns That the site changed, with the freshness label to check; otherwise that nothing was replaced, in the past tense of the stop, which a later publish of a chat that goes on leaves true.
   * @example siteAtOverwriteStop(false) // => 'Nothing was replaced.'
   */
  const siteAtOverwriteStop = (replaced: boolean): string =>
    replaced
      ? 'The site on disk changed during the run; ' + freshnessStep
      : 'Nothing was replaced.'
  /**
   * Words a run that stopped before it would overwrite the learner's own files; called by {@link describeConflict} for a cause that did not refuse the start.
   * @param at - When the run stopped, as the learner's local time.
   * @param site - What became of the site, as {@link siteAtOverwriteStop} words it.
   * @param named - The paths as the sentence names them.
   * @param many - Whether more than one file is in the way.
   * @param isChatStillThere - Whether the agent was not stopped with the run (VS Code's chat, which Codebook only stopped watching): the next step then names that chat and its two ways on, to answer it so that it publishes, or to stop it and press, which Codebook answers with the wait for it. The step is kept short: with twelve long paths the sentence must still fit the rail's bound of 45vh at 960 x 600.
   * @returns The rest of the sentence after "Update stopped", with the next step.
   * @example describeOverwriteStop('21:10', 'Nothing was replaced.', 'notes.md', false, false) // => ' at 21:10: it would overwrite your own file in the Wiki folder (notes.md). Nothing was replaced. Move or rename the file, then press Update LLM Wiki again.'
   */
  const describeOverwriteStop = (
    at: string,
    site: string,
    named: string,
    many: boolean,
    isChatStillThere: boolean,
  ): string =>
    ' at ' +
    at +
    ': it would overwrite your own ' +
    (many ? 'files' : 'file') +
    ' in the Wiki folder (' +
    named +
    '). ' +
    site +
    ' Move or rename ' +
    (many ? 'them' : 'the file') +
    (isChatStillThere
      ? '. The VS Code chat was not stopped: answer it and it can publish, or stop it and press Update LLM Wiki, then Update anyway if Codebook still waits for it.'
      : ', then press Update LLM Wiki again.')
  /**
   * Words an update that paths in the Wiki folder kept from starting or from finishing; called by {@link describeStoppedRun} for the state `conflict`.
   * @param conflict - The conflict state.
   * @param at - When the conflict was found, as the learner's local time.
   * @param replaced - Whether the site on disk changed during the run.
   * @returns The description: "Update not started" for a cause that refused the start, "Update stopped" otherwise (also for a cause this version does not know), with the chat named for VS Code, where it was not stopped; `detail` holds all paths when the sentence names only the first.
   * @example describeConflict(conflict, '21:10', false).lead // => 'Update not started'
   */
  const describeConflict = (
    conflict: WikiUpdateStatusOf<'conflict'>,
    at: string,
    replaced: boolean,
  ): WikiUpdateDescription => {
    const { named, detail } = shownPaths(conflict.paths)
    const many = conflict.paths.length > 1
    const refusal =
      describePageRefusal(conflict.cause, named, many) ??
      describeFolderRefusal(conflict.cause, named) ??
      describeRecoveryRefusal(conflict.cause, named)
    if (refusal !== undefined)
      return describe('Update not started', ' (' + at + '): ' + refusal, detail)
    // Only a Cursor agent is stopped with its run; VS Code's chat goes on after the watch.
    const isChatStillThere = conflict.host !== 'cursor'
    return describe(
      'Update stopped',
      describeOverwriteStop(
        at,
        siteAtOverwriteStop(replaced),
        named,
        many,
        isChatStillThere,
      ),
      detail,
    )
  }
  /**
   * Words a run that was stopped before it gave a result; called by {@link describeEnded} for every state that is neither a success nor a failure.
   * @param stopped - The cancelled, timed-out or conflict state.
   * @param at - When the run ended, as the learner's local time.
   * @param replaced - Whether the site on disk was replaced meanwhile.
   * @returns The description of the state.
   * @example describeStoppedRun(cancelled, '21:10', false).lead // => 'Update cancelled'
   */
  const describeStoppedRun = (
    stopped: WikiUpdateStatusOf<'cancelled' | 'timed-out' | 'conflict'>,
    at: string,
    replaced: boolean,
  ): WikiUpdateDescription => {
    if (stopped.state === 'cancelled')
      return describeCancelled(stopped, at, replaced)
    if (stopped.state === 'timed-out')
      return describeTimedOut(stopped, at, replaced)
    return describeConflict(stopped, at, replaced)
  }
  /**
   * Words a start that was refused because nothing needed updating; called by {@link describeEnded} for the state `already-current`.
   * @param alreadyCurrent - The already-current state.
   * @param at - When the check was made, as the learner's local time.
   * @returns The description: that the Wiki matches the source; in a folder without a Git repository, that every indexed source matches, that added files are not checked and what to do for a new file.
   * @example describeAlreadyCurrent(alreadyCurrent, '21:10').rest // => ' (checked 21:10): this Wiki matches the source, so no update started.'
   */
  const describeAlreadyCurrent = (
    alreadyCurrent: WikiUpdateStatusOf<'already-current'>,
    at: string,
  ): WikiUpdateDescription =>
    describe(
      'Already current',
      ' (checked ' +
        at +
        // Without a Git repository added files were not looked for, and the button cannot update the Wiki for one.
        (alreadyCurrent.addedFilesUnchecked
          ? '): every indexed source matches, so no update started. Added files are not checked because this folder has no Git repository; ask the editor chat to update the Wiki for a new file.'
          : '): this Wiki matches the source, so no update started.'),
    )
  /**
   * Words a run that is over; called by {@link describeWikiUpdate} for every state after `running`.
   * @param ended - The state of the ended run.
   * @param at - When the run ended, as the learner's local time.
   * @returns The description of the state.
   * @example describeEnded(alreadyCurrent, '21:10').lead // => 'Already current'
   */
  const describeEnded = (
    ended: Exclude<WikiUpdateStatus, { state: 'idle' | 'running' }>,
    at: string,
  ): WikiUpdateDescription => {
    if (ended.state === 'succeeded') return describeSucceeded(ended, at)
    if (ended.state === 'already-current')
      return describeAlreadyCurrent(ended, at)
    const replaced = ended.site === 'replaced'
    if (ended.state === 'failed') return describeFailed(ended, at, replaced)
    return describeStoppedRun(ended, at, replaced)
  }
  /**
   * Says whether this version knows a state as one of a run that is over; called by {@link describeWikiUpdate} before it reads the fields of such a state.
   * @param state - The state's name as the extension answered it.
   * @returns `true` for `succeeded`, `already-current`, `failed`, `cancelled`, `timed-out` and `conflict`; `false` for any other name, which a newer extension may answer.
   * @example isKnownEnding('paused') // => false
   */
  const isKnownEnding = (state: string): boolean =>
    [
      'succeeded',
      'already-current',
      'failed',
      'cancelled',
      'timed-out',
      'conflict',
    ].indexOf(state) >= 0
  if (status.state === 'running') return describeRunning(status)
  // A state this version does not know may carry no time either, so it is worded before its time is read.
  if (!isKnownEnding(status.state))
    return describe('Update status unknown', '.')
  return describeEnded(status, wording.formatTime(status.finishedAt))
}
