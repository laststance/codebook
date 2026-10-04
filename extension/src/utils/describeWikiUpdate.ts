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
  /** Where the reader finds the freshness label, as the end of "check the freshness label …": `above` on the page, `in the browser reader` in an editor notification. */
  freshnessLabelPlace: string
  /** Whether the reading page was served from another publication than the one on disk now; omitted by the editor, which never offers a reload. */
  isPageOlderThanSite?: boolean
}

/**
 * Writes what the browser Wiki and the editor notification say for one update state.
 *
 * Why: page and editor must say the same thing, say whether the site was kept or replaced, and name the next step. The function is embedded into the served page script with `toString()`, so it must stay free of imports and outer variables.
 * Trigger: the reader page calls it with each `api/update-status` answer; the editor calls it when a run ends.
 *
 * @param status - Update run state from the extension.
 * @param wording - Time format, the bounds of the sentence, the minute length, where the freshness label is and whether the reading page is older than the site.
 * @returns
 * - Idle: undefined (nothing to show)
 * - A state this version does not know: "Update status unknown."
 * - Otherwise: the lead words, the rest of the sentence, shortened detail and the output line
 *
 * @example
 * ```ts
 * describeWikiUpdate(
 *   { state: 'cancelled', host: 'cursor', finishedAt: '2026-10-03T12:10:00.000Z', site: 'kept', outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' },
 *   { formatTime: () => '21:10', pathLimit: 3, reasonLimitChars: 200, msPerMinute: 60_000, freshnessLabelPlace: 'above' },
 * )
 * // => { lead: 'Update cancelled', rest: ' at 21:10. Cursor Agent was stopped. The last usable site is kept.', detail: [], output: 'Output: .codebook/wiki', offerReload: false }
 * ```
 */
export function describeWikiUpdate(
  status: WikiUpdateStatus,
  wording: WikiUpdateWording,
): WikiUpdateDescription | undefined {
  if (status.state === 'idle') return undefined
  const output = 'Output: ' + (status.outputLabel || status.outputDirectory)
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
  // The chat request of the publisher's recovery, as the learner pastes it, after the first letter of "Ask" or "ask"; the function is embedded into the page and cannot import it.
  const recoveryStep =
    'sk the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.'
  const freshnessStep =
    'check the freshness label ' + wording.freshnessLabelPlace + '.'
  if (status.state === 'running') {
    const since = wording.formatTime(status.startedAt)
    const bound = minutes(status.timeoutMs)
    if (status.host === 'cursor')
      return describe(
        'Updating LLM Wiki…',
        (status.candidateStaged
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
    return describe(
      'Updating LLM Wiki…',
      (status.candidateStaged
        ? ' The VS Code chat is preparing a new site (request sent ' +
          since +
          '). Approve the steps it asks for. Codebook watches for the publish for up to '
        : ' The request went to the VS Code chat at ' +
          since +
          '. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to ') +
        bound +
        '. This site stays readable.' +
        // The chat asks for each step outside the workspace; the learner should know why and how to avoid it.
        (status.isOutputOutsideProject
          ? ' This Wiki’s output lies outside the project, so the chat will ask to approve each step there; an output inside the project (codebook.wikiOutputDirectory) needs none.'
          : ''),
    )
  }
  const at = wording.formatTime(status.finishedAt)
  if (status.state === 'succeeded') {
    // The page compares the publication it was served from with the one on disk, never two clocks.
    const offerReload = wording.isPageOlderThanSite === true
    // Without a Git repository no revision was checked, and neither were added files.
    if (status.revision === undefined)
      return describe(
        'Updated',
        ' at ' +
          at +
          ' (index ' +
          status.index +
          '; no Git revision recorded, so added files are not checked).',
        [],
        offerReload,
      )
    return describe(
      'Updated',
      ' at ' +
        at +
        ' to revision ' +
        status.revision +
        ' (index ' +
        status.index +
        ').',
      [],
      offerReload,
    )
  }
  if (status.state === 'already-current')
    return describe(
      'Already current',
      ' (checked ' +
        at +
        '): this Wiki matches the source, so no update started.',
    )
  const replaced = status.site === 'replaced'
  if (status.state === 'failed') {
    const trimmed = status.reason.trim()
    // A sentence Codebook wrote ends with its next step, so it is shown whole; only an agent's, the CLI's or a thrown error's text is cut.
    const isShortened =
      !status.isCodebookSentence && trimmed.length > wording.reasonLimitChars
    // The cut falls on the last space before the limit, so no word is broken; a reason without one is cut at the limit.
    const lastSpace = trimmed.lastIndexOf(' ', wording.reasonLimitChars)
    const shown = isShortened
      ? trimmed
          .slice(0, lastSpace > 0 ? lastSpace : wording.reasonLimitChars)
          .trimEnd() + '…'
      : trimmed
    // A reason from a thrown error often has no full stop; it must not run into the next sentence.
    const sentence = /[.!?…]$/.test(shown) ? shown : shown + '.'
    const detail = isShortened ? [trimmed] : []
    if (replaced)
      return describe(
        'Update needs another run',
        ' (' + at + '): ' + sentence + ' This run replaced the site on disk.',
        detail,
      )
    // A Wiki that is gone was neither kept nor replaced; the reason says what to do.
    if (status.site === 'missing')
      return describe('Update failed', ' at ' + at + ': ' + sentence, detail)
    return describe(
      'Update failed',
      ' at ' + at + ': ' + sentence + ' The last usable site is kept.',
      detail,
    )
  }
  if (status.state === 'cancelled') {
    if (status.host === 'cursor')
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
  if (status.state === 'timed-out') {
    const bound = minutes(status.timeoutMs)
    if (status.host === 'cursor')
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
          : '. Nothing has been replaced. Check the VS Code chat: it may be waiting for you or have reported a problem. Press Update LLM Wiki to start again.'),
    )
  }
  if (status.state === 'conflict') {
    const isShortened = status.paths.length > wording.pathLimit
    const named =
      status.paths.slice(0, wording.pathLimit).join(', ') +
      (isShortened
        ? ' and ' + (status.paths.length - wording.pathLimit) + ' more'
        : '')
    const detail = isShortened ? status.paths.slice() : []
    const many = status.paths.length > 1
    const notStarted = ' (' + at + '): '
    if (status.cause === 'edited-page')
      return describe(
        'Update not started',
        notStarted +
          (many ? 'generated pages were' : 'a generated page was') +
          ' edited by hand (' +
          named +
          '), and the publisher will not overwrite ' +
          (many ? 'them' : 'it') +
          '. Move your change aside or restore the ' +
          (many ? 'pages' : 'page') +
          ', then press Update LLM Wiki again.',
        detail,
      )
    if (status.cause === 'missing-page')
      return describe(
        'Update not started',
        notStarted +
          (many ? 'generated pages are' : 'a generated page is') +
          ' missing (' +
          named +
          '). Restore ' +
          (many ? 'them' : 'it') +
          ' from Git or the editor’s local history; if you cannot, move the Wiki folder aside and ask the editor chat "/codebook Generate the LLM Wiki for this project".',
        detail,
      )
    if (status.cause === 'special-file')
      return describe(
        'Update not started',
        notStarted +
          'the Wiki folder holds ' +
          (many ? 'links or special files' : 'a link or special file') +
          ' (' +
          named +
          '), which the publisher refuses. Move ' +
          (many ? 'them' : 'it') +
          ' out of the Wiki folder, then press Update LLM Wiki again.',
        detail,
      )
    if (status.cause === 'edited-manifest')
      return describe(
        'Update not started',
        notStarted +
          'the Wiki’s manifest (' +
          named +
          ') was changed after it was published, and the publisher will not replace it. Keep a copy of your change, a' +
          recoveryStep,
        detail,
      )
    if (status.cause === 'unreadable-manifest')
      return describe(
        'Update not started',
        notStarted +
          'Codebook cannot read the Wiki’s manifest (' +
          named +
          '). A' +
          recoveryStep,
        detail,
      )
    if (status.cause === 'unfinished-publish')
      return describe(
        'Update not started',
        notStarted +
          'an earlier publish did not finish (' +
          named +
          '). A' +
          recoveryStep,
        detail,
      )
    return describe(
      'Update stopped',
      ' at ' +
        at +
        ': it would overwrite your own ' +
        (many ? 'files' : 'file') +
        ' in the Wiki folder (' +
        named +
        '). ' +
        (replaced
          ? 'The site on disk changed during the run; ' + freshnessStep
          : 'Nothing was replaced.') +
        ' Move or rename ' +
        (many ? 'them' : 'the file') +
        ', then press Update LLM Wiki again.',
      detail,
    )
  }
  // A newer extension may answer a state this page does not know.
  return describe('Update status unknown', '.')
}
