import type { SignInRequiredReason } from '../constants'

/**
 * Words, in one sentence for the learner, why a run needs a saved session.
 *
 * Why it exists: the notice of a refused run ({@link installSavedSessions}) and the saved-session status item's tooltip ({@link savedSessionStatusText}) say the same thing; one copy keeps the two from disagreeing when a reason's wording changes. The chat's own sentence is {@link signInRequiredMessage}.
 * @param reason - Why the run needs it: see `SIGN_IN_REQUIRED_REASONS`.
 * @param repositoryName - The repository folder's name; never a path.
 * @returns One sentence per reason, naming the repository and never claiming that anyone is signed in.
 * @example
 * signInRequiredNotice('no-saved-session', 'shop')      // => 'This run needs a saved session for shop.'
 * signInRequiredNotice('redirected-to-sign-in', 'shop') // => 'The saved session for shop may have expired. Set it up again.'
 */
export function signInRequiredNotice(
  reason: SignInRequiredReason,
  repositoryName: string,
): string {
  switch (reason) {
    case 'no-saved-session':
      return `This run needs a saved session for ${repositoryName}.`
    case 'setup-not-finished':
      return `The last setup for ${repositoryName} was closed without Done, so runs do not use it.`
    case 'redirected-to-sign-in':
      return `The saved session for ${repositoryName} may have expired. Set it up again.`
    case 'session-cookie-only':
      return `${repositoryName} keeps its sign-in only while the browser stays open, so a saved session cannot keep it.`
  }
}
