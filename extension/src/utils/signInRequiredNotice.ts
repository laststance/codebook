import type { SignInRequiredReason } from '../constants'

/**
 * Words, in one sentence for the learner, why a run needs a saved session.
 *
 * Why it exists: the notice of a refused run ({@link installSavedSessions}) and the saved-session status item's tooltip ({@link savedSessionStatusText}) say the same thing; one copy keeps the two from disagreeing when a reason's wording changes. The chat's own sentence is {@link signInRequiredMessage}.
 * @param reason - Why the run needs it: see `SIGN_IN_REQUIRED_REASONS`.
 * @param repositoryName - The repository folder's name; never a path.
 * @param declaredOrigin - The origin a `reverseProxy` run declared (API 1.40); when given, the notice names it and asks to set up there, except for `session-cookie-only`, whose notice keeps that reason's condition (a setup that the next run would refuse again is not offered). The status item's tooltip passes none and keeps the reason sentence.
 * @returns One sentence per reason, naming the repository and never claiming that anyone is signed in; the declared-origin sentence when an origin is given.
 * @example
 * signInRequiredNotice('no-saved-session', 'shop')      // => 'This run needs a saved session for shop.'
 * signInRequiredNotice('redirected-to-sign-in', 'shop') // => 'The saved session for shop may have expired. Set it up again.'
 * signInRequiredNotice('no-saved-session', 'shop', 'https://app.example.test') // => 'This run opens the app at https://app.example.test and needs your saved sign-in there. Set up the saved session at that address?'
 * signInRequiredNotice('session-cookie-only', 'shop', 'https://app.example.test') // => 'This run opens the app at https://app.example.test, but the app keeps your sign-in only while the browser stays open. Set up the saved session at that address only if the sign-in page offers a keep-me-signed-in choice, and select it.'
 */
export function signInRequiredNotice(
  reason: SignInRequiredReason,
  repositoryName: string,
  declaredOrigin?: string,
): string {
  // A session-cookie-only app is set up again only with the app's keep-me-signed-in choice; an unconditional invitation would be refused again by the next run.
  if (declaredOrigin !== undefined && reason === 'session-cookie-only')
    return `This run opens the app at ${declaredOrigin}, but the app keeps your sign-in only while the browser stays open. Set up the saved session at that address only if the sign-in page offers a keep-me-signed-in choice, and select it.`
  // Any other reason at a declared origin needs the session set up at that origin, so the notice names it.
  if (declaredOrigin !== undefined)
    return `This run opens the app at ${declaredOrigin} and needs your saved sign-in there. Set up the saved session at that address?`
  switch (reason) {
    case 'no-saved-session':
      return `This run needs a saved session for ${repositoryName}.`
    case 'setup-not-finished':
      return `The last setup for ${repositoryName} was closed without Done, so runs do not use it.`
    case 'redirected-to-sign-in':
      return `The saved session for ${repositoryName} may have expired. Set it up again.`
    case 'session-cookie-only':
      return `${repositoryName} keeps its sign-in only while the browser stays open, so a saved session cannot keep it.`
    // The editor shows no notice for this reason (the run skipped the saved session; there is nothing to set up); the sentence keeps the switch complete.
    case 'package-root-fresh-session':
      return `This run is for a package below the root of ${repositoryName}, which has no saved session in this version.`
  }
}
