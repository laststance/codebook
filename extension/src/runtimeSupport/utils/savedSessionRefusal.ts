import { BUSY_PROFILE_IN_USE_RECOVERY, StudyError } from '../../errors'
import type { SavedSessionUnusableReason } from '../savedSessionTypes'

import type { SignInLockConflict } from './signInLock'

/**
 * Words the refusal a held saved-session lock gives, as the coded error the service sends to the chat; called by the store when a run, a setup or a removal meets a lock it cannot take.
 * No message or detail names a path, a hash or a cookie. `BUSY` carries `reason: 'profile-in-use'`, `heldBy` and `sent: 'not-sent'` with its own recovery.
 * @param conflict - What the lock mapping decided ({@link lockConflictOf}).
 * @param repositoryName - The repository's folder name, shown to the learner.
 * @returns The error to throw.
 * @example
 * throw savedSessionRefusal({ code: 'SIGN_IN_IN_PROGRESS', heldBy: 'setup' }, 'dashboard')
 */
export function savedSessionRefusal(
  conflict: SignInLockConflict,
  repositoryName: string,
): StudyError {
  if (conflict.code === 'SIGN_IN_IN_PROGRESS')
    return new StudyError(
      'SIGN_IN_IN_PROGRESS',
      `A saved-session setup for ${repositoryName} is open, so nothing started.`,
      undefined,
      undefined,
      undefined,
      { sent: 'not-sent', sideEffects: 'none' },
    )
  if (conflict.code === 'BUSY')
    return new StudyError(
      'BUSY',
      `Another run of ${repositoryName} uses the saved session, so this run did not start and no second browser opened.`,
      undefined,
      BUSY_PROFILE_IN_USE_RECOVERY,
      undefined,
      {
        reason: 'profile-in-use',
        heldBy: conflict.heldBy ?? 'run',
        sent: 'not-sent',
        sideEffects: 'none',
      },
    )
  return new StudyError(
    'SIGN_IN_PROFILE_IN_USE',
    `The saved session of ${repositoryName} is in use, so nothing was changed.`,
    undefined,
    undefined,
    undefined,
    { sent: 'not-sent', sideEffects: 'none' },
  )
}

/**
 * Words the refusal for a saved-session folder the store cannot use; called by the store's admission and setup.
 * @param reason - Why ({@link SavedSessionUnusableReason}), carried as `details.reason`.
 * @param repositoryName - The repository's folder name.
 * @returns The error to throw.
 * @example
 * throw savedSessionUnusable('chrome-version', 'dashboard')
 */
export function savedSessionUnusable(
  reason: SavedSessionUnusableReason,
  repositoryName: string,
): StudyError {
  return new StudyError(
    'SIGN_IN_PROFILE_UNUSABLE',
    `Codebook cannot use the saved session of ${repositoryName} (${reason}).`,
    undefined,
    undefined,
    undefined,
    { reason, sent: 'not-sent', sideEffects: 'none' },
  )
}
