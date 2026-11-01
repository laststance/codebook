import type { SignInRequiredReason } from '../constants'

/**
 * Words the failure of a run whose page asked for sign-in, for the run's error and Output line.
 *
 * Why it exists: the learner and the chat read the same sentence, so it names the repository folder and the reason, never a path, a cookie or a statement that anyone is signed in. Called by {@link ConfiguredBrowserRun} when it fails a run with `SIGN_IN_REQUIRED`.
 * @param reason - Why the page asked: see `SIGN_IN_REQUIRED_REASONS`.
 * @param repositoryName - The repository folder's name.
 * @param landedOn - The declared sign-in path the page landed on, when a navigation caused the refusal.
 * @param operationIndex - The operation (1-based) that was sent before the page landed there; absent when the entry load landed there.
 * @returns One sentence per reason.
 * @example
 * signInRequiredMessage('no-saved-session', 'shop')
 * // => 'The app asked for sign-in and shop has no saved session, so the run stopped before it sent anything. …'
 */
export function signInRequiredMessage(
  reason: SignInRequiredReason,
  repositoryName: string,
  landedOn?: string,
  operationIndex?: number,
): string {
  const where = landedOn === undefined ? 'a sign-in page' : landedOn
  const when =
    operationIndex === undefined
      ? 'before it sent anything'
      : `after operation ${operationIndex}`
  const asked = `The page landed on ${where}`
  switch (reason) {
    case 'no-saved-session':
      return `${asked} and ${repositoryName} has no saved session, so the run stopped ${when}. Ask the learner to run Codebook: Set Up Saved Session…, then start one new run.`
    case 'setup-not-finished':
      return `${asked}; the saved-session setup of ${repositoryName} was closed before Done, so the run used a fresh profile and stopped ${when}. Ask the learner to run Codebook: Set Up Saved Session… and finish it with Done, then start one new run.`
    case 'redirected-to-sign-in':
      return `${asked} although the run used the saved session of ${repositoryName}, so the saved session may have expired. The run stopped ${when}. Ask the learner to run Codebook: Set Up Saved Session… again, then start one new run.`
    case 'session-cookie-only':
      return `${asked}: ${repositoryName} keeps its sign-in only while the browser stays open, so a saved session cannot keep it. The run stopped ${when}.`
  }
}
