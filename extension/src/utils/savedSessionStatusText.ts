import type { SignInRequiredReason } from '../constants'
import type { SavedSessionView } from '../runtimeSupport/savedSessionSetupTypes'
import type { SetupPhase } from '../savedSessionSetup'

import { formatSetupTime, type SetupTimeFormat } from './formatSetupTime'
import { signInRequiredNotice } from './signInRequiredNotice'

/** What the saved-session status item can show: a stored session's view, a setup of this window, or a run's need for a saved session. */
export type SavedSessionStatusInput =
  | { kind: 'view'; view: SavedSessionView }
  | { kind: 'setup'; phase: SetupPhase }
  | { kind: 'review'; repositoryName: string }
  | { kind: 'needed'; reason: SignInRequiredReason; repositoryName: string }

/** The text and tooltip of the status item. */
export type SavedSessionStatusText = { text: string; tooltip: string }

const SETUP_TEXTS: Record<
  Exclude<SetupPhase['phase'], 'ended'>,
  (name: string) => SavedSessionStatusText
> = {
  starting: (name) => ({
    text: '$(key) Saved session · starting setup',
    tooltip: `Starting ${name} to open its sign-in page.`,
  }),
  open: (name) => ({
    text: '$(key) Saved session · setup open',
    tooltip: `Sign in to ${name} in the Codebook browser window, then choose Done.`,
  }),
  finishing: (name) => ({
    text: '$(key) Saved session · saving',
    tooltip: `Closing the Codebook browser for ${name}.`,
  }),
  stuck: (name) => ({
    text: '$(warning) Saved session · browser not closed',
    tooltip: `Codebook could not confirm that the browser for ${name} exited. Quit it, then retry.`,
  }),
}

/** Words a stored session's state; `undefined` hides the item (nothing to show). */
function viewText(
  view: SavedSessionView,
  format: SetupTimeFormat,
): SavedSessionStatusText | undefined {
  const name = view.repositoryName
  if (view.state === 'saved' && view.setupAt)
    return {
      text: `$(key) Saved session · set up ${formatSetupTime(view.setupAt, format)}`,
      tooltip: `Saved session for ${name}. Codebook does not check whether the app still has you signed in.`,
    }
  // A setup of this window shows through its own phase; a stored setup-open state is almost always another window's, whose Done and Close setup are only there.
  if (view.state === 'setup-open')
    return view.setupOpenHere
      ? SETUP_TEXTS.open(name)
      : {
          text: SETUP_TEXTS.open(name).text,
          tooltip: `A setup for ${name} is open in another editor window. Choose Done or Close setup there.`,
        }
  if (view.state === 'unconfirmed')
    return {
      text: '$(key) Saved session · setup not finished',
      tooltip: signInRequiredNotice('setup-not-finished', name),
    }
  if (view.state === 'unusable')
    return {
      text: '$(warning) Saved session · unusable',
      tooltip: `Codebook cannot use the saved session for ${name}. Remove it, then set it up again.`,
    }
  return undefined
}

/**
 * Words the saved-session status item (DES-2, DES-5, X7): never "signed in" as a fact, always the setup date and time when a session is saved.
 * Called by {@link installSavedSessions} whenever the store, a setup or a refused run changes what the item shows.
 * @param input - A stored session's view, a setup phase of this window, or the reason a run needs a saved session.
 * @param format - The zone and locale of the setup time; tests pin both.
 * @returns The item's text and tooltip; `undefined` when nothing is worth showing (no session and no setup).
 * @example
 * savedSessionStatusText({ kind: 'view', view: { available: true, state: 'saved', setupAt: '2026-11-02T12:10:00.000Z', repositoryName: 'shop', setupOpenHere: false } }, { timeZone: 'UTC', locale: 'en-US' })
 * // => { text: '$(key) Saved session · set up Nov 2, 12:10 PM', tooltip: 'Saved session for shop. …' }
 */
export function savedSessionStatusText(
  input: SavedSessionStatusInput,
  format: SetupTimeFormat = {},
): SavedSessionStatusText | undefined {
  if (input.kind === 'view') return viewText(input.view, format)
  if (input.kind === 'setup')
    return input.phase.phase === 'ended'
      ? undefined
      : SETUP_TEXTS[input.phase.phase](input.phase.repositoryName)
  if (input.kind === 'review')
    return {
      text: '$(key) Saved session · operations not confirmed',
      tooltip: `A run with the saved session for ${input.repositoryName} waits for you to confirm its operations. Choose Review operations again.`,
    }
  return {
    text: '$(key) Saved session needed',
    tooltip: signInRequiredNotice(input.reason, input.repositoryName),
  }
}
