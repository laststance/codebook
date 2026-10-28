/** Which replay a refusal sentence names: a test replay or a server replay. */
export type ReplayKind = 'test' | 'server'

/**
 * Every refusal sentence the Study workspace and the history playback controller give for a Node replay, in both forms: the test replay's and the server replay's. Both forms are written out so no sentence is made by swapping words in another.
 * Read through {@link replayRefusal}.
 */
export const REPLAY_REFUSALS = {
  changedDuringPlayback: {
    test: 'The selected test replay changed during playback.',
    server: 'The selected server replay changed during playback.',
  },
  selectBeforePaging: {
    test: 'Select the matching test replay before paging.',
    server: 'Select the matching server replay before paging.',
  },
  closeBrowserBeforeNavigating: {
    test: 'Close browser replay before navigating a test replay.',
    server: 'Close browser replay before navigating a server replay.',
  },
  selectSavedBeforeNavigating: {
    test: 'Select the matching saved test replay before navigating its timeline.',
    server:
      'Select the matching saved server replay before navigating its timeline.',
  },
  selectBeforeUnderstanding: {
    test: 'Select the matching test replay before saving an understanding choice.',
    server:
      'Select the matching server replay before saving an understanding choice.',
  },
  selectBeforeLearningMaterial: {
    test: 'Select the matching test replay before saving its learning material.',
    server:
      'Select the matching server replay before saving its learning material.',
  },
  pageUnavailable: {
    test: 'The requested page of this test replay is unavailable.',
    server: 'The requested page of this server replay is unavailable.',
  },
  closeBrowserBeforeInspecting: {
    test: 'Close browser replay before inspecting a stop of a test replay.',
    server: 'Close browser replay before inspecting a stop of a server replay.',
  },
  selectSavedBeforeInspecting: {
    test: 'Select the matching saved test replay before inspecting its debugger state.',
    server:
      'Select the matching saved server replay before inspecting its debugger state.',
  },
  eventNotAStop: {
    test: 'The requested event of this test replay is not a debugger stop.',
    server: 'The requested event of this server replay is not a debugger stop.',
  },
  closeBrowserBeforeControlling: {
    test: 'Close browser replay before controlling a test replay.',
    server: 'Close browser replay before controlling a server replay.',
  },
  selectSavedBeforeControlling: {
    test: 'Select the matching saved test replay before controlling its timeline.',
    server:
      'Select the matching saved server replay before controlling its timeline.',
  },
  positionOnlyForSeek: {
    test: 'Only a seek in a test replay accepts a position.',
    server: 'Only a seek in a server replay accepts a position.',
  },
  seekNeedsTime: {
    test: 'A seek in a test replay needs a recorded time.',
    server: 'A seek in a server replay needs a recorded time.',
  },
  seekOutsideRange: {
    test: 'Seek lies outside the verified range of this test replay.',
    server: 'Seek lies outside the verified range of this server replay.',
  },
} as const

/** The key of one catalogued refusal sentence. */
export type ReplayRefusalKey = keyof typeof REPLAY_REFUSALS

/**
 * Gives one refusal sentence in the words of the replay that is shown, so a server replay is never called a test replay in a sentence that reaches the transport's status line.
 * Called by the Study workspace and by {@link NodeHistoryPlaybackController} when they refuse a replay control.
 * @param key - Which refusal.
 * @param kind - The replay that is shown.
 * @returns The catalogued sentence of that form.
 * @example replayRefusal('selectBeforePaging', 'server') // => 'Select the matching server replay before paging.'
 */
export function replayRefusal(key: ReplayRefusalKey, kind: ReplayKind): string {
  return REPLAY_REFUSALS[key][kind]
}

/**
 * Words the refusal of a step that has no target in the shown replay, in both replays' words.
 * @param kind - The replay that is shown.
 * @param direction - `previous` or `next`.
 * @param unit - `event` or `stop`; `event` when the message names none.
 * @returns The sentence.
 * @example replayNoStep('server', 'next', 'stop') // => 'There is no next stop in this server replay.'
 */
export function replayNoStep(
  kind: ReplayKind,
  direction: string,
  unit: string | undefined,
): string {
  return kind === 'server'
    ? `There is no ${direction} ${unit ?? 'event'} in this server replay.`
    : `There is no ${direction} ${unit ?? 'event'} in this test replay.`
}
