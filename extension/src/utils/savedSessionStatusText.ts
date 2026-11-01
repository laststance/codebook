import type { SignInRequiredReason } from '../constants'
import type { SavedSessionView } from '../runtimeSupport/savedSessionSetupTypes'
import type { SetupPhase } from '../savedSessionSetup'

import { formatSetupTime, type SetupTimeFormat } from './formatSetupTime'

/** What the saved-session status item can show: a stored session's view, a setup of this window, or a run's need for a saved session. */
export type SavedSessionStatusInput =
  | { kind: 'view'; view: SavedSessionView }
  | { kind: 'setup'; phase: SetupPhase }
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

const NEEDED_TOOLTIPS: Record<SignInRequiredReason, (name: string) => string> =
  {
    'no-saved-session': (name) => `This run needs a saved session for ${name}.`,
    'setup-not-finished': (name) =>
      `The last setup for ${name} was closed without Done, so runs do not use it.`,
    'redirected-to-sign-in': (name) =>
      `The saved session for ${name} may have expired. Set it up again.`,
    'session-cookie-only': (name) =>
      `${name} keeps its sign-in only while the browser stays open, so a saved session cannot keep it.`,
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
  if (view.state === 'setup-open') return SETUP_TEXTS.open(name)
  if (view.state === 'unconfirmed')
    return {
      text: '$(key) Saved session · setup not finished',
      tooltip: `The last setup for ${name} was closed without Done, so runs do not use it.`,
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
  return {
    text: '$(key) Saved session needed',
    tooltip: NEEDED_TOOLTIPS[input.reason](input.repositoryName),
  }
}
