/**
 * How the captured source of a Study whose layout is not confirmed stands, as {@link StudyWorkspace} reads it from its own work and the editor's tabs when the source is not in front of its pane.
 * - `placing`: the reader's own display or arrangement of the source is under way.
 * - `set-aside`: the learner's Return to Wiki gave the article's groups back and left the Study open behind them.
 * - `covered`: a tab of the captured source is open, behind another tab of its group.
 * - `closed`: no tab of the captured source is open.
 * - `not-shown`: neither of these: the selection's source was not shown, or the tab in front is not its current display (a display that failed).
 */
export type CapturedSourceStanding =
  'placing' | 'set-aside' | 'covered' | 'closed' | 'not-shown'

/** Where the learner reads the reason, which decides the control the reason names: the Learning summary of a recording, the strip of a Live run, or the Study pane. */
export type CapturedSourceView = 'recording' | 'live' | 'study'

/** The reader's own placement is under way, so waiting is what brings the source; the only standing with nothing for the learner to do. */
const PLACING_REASON =
  'The current captured source is not ready in its native pane. Wait for it, or use Return to current with the latest reader revision before restoring the layout.'

/** What holds for each standing the learner can act on. */
const STANDING_FACTS: Record<
  Exclude<CapturedSourceStanding, 'placing' | 'set-aside'>,
  string
> = {
  covered: 'The tab of the captured source is behind another tab.',
  closed: 'The tab of the captured source was closed.',
  'not-shown': 'The current captured source is not ready in its native pane.',
}

/** The control that shows the captured source again where the learner reads the reason (each was observed to confirm the layout again in the workspace harness). */
const SHOW_AGAIN: Record<CapturedSourceView, string> = {
  recording: 'Use Reload saved recording in Playback details to show it again.',
  live: 'Use Return to current pause to show it again.',
  study: 'Use Focus source to show it again.',
}

/**
 * Words the reason a presentation state gives while the captured source is not in front of its pane and no recording is loading or failed, for {@link StudyWorkspace.presentationState}: it says what holds and the control that brings the Study back, and asks the learner to wait only while the reader itself is still placing the source (Cycle 0046 row 695).
 * After the learner's Return to Wiki the Study stays open behind the article's groups (row 567's retention, D2=A): nothing is pending there and a saved study has no current pause, so the reader's former catch-all, "Wait for it, or use Return to current…", promised something that never came; View recording or View observation in the Wiki, or Reload saved recording, brings the Study back.
 * @param standing - How the captured source stands ({@link CapturedSourceStanding}).
 * @param view - Where the learner reads the reason ({@link CapturedSourceView}).
 * @returns One line: what holds, and the step that brings the Study back.
 * @example
 * capturedSourceNotShownReason('placing', 'study')
 * // => 'The current captured source is not ready in its native pane. Wait for it, or use Return to current with the latest reader revision before restoring the layout.'
 * capturedSourceNotShownReason('set-aside', 'recording')
 * // => 'The Study is set aside since Return to Wiki, so its captured source is not in front of its native pane. Use View recording in the Repository Wiki, or Reload saved recording, to bring the Study back.'
 * capturedSourceNotShownReason('closed', 'study')
 * // => 'The tab of the captured source was closed. Use Focus source to show it again.'
 */
export function capturedSourceNotShownReason(
  standing: CapturedSourceStanding,
  view: CapturedSourceView,
): string {
  if (standing === 'placing') return PLACING_REASON
  if (standing === 'set-aside')
    return `The Study is set aside since Return to Wiki, so its captured source is not in front of its native pane. ${
      view === 'recording'
        ? 'Use View recording in the Repository Wiki, or Reload saved recording, to bring the Study back.'
        : 'Use View observation in the Repository Wiki to bring the Study back.'
    }`
  return `${STANDING_FACTS[standing]} ${SHOW_AGAIN[view]}`
}
