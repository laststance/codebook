import type { SignInRequiredReason } from '../constants'

/** What a run knows when it words its `SIGN_IN_REQUIRED`: the repository folder, where the page landed, after which operation, and whether the configuration declared `session: "fresh"`. */
export type SignInRequiredFacts = {
  /** The repository folder's name. */
  repositoryName: string
  /** The declared sign-in path the page landed on, when a navigation caused the refusal. */
  landedOn?: string
  /** The operation (1-based) that was sent before the page landed there; absent when the entry load landed there. */
  operationIndex?: number
  /** The configuration declared `session: "fresh"`, so the run did not use the saved session whether or not one exists. */
  declaredFresh?: boolean
}

/**
 * Words the failure of a run whose page asked for sign-in, for the run's error and Output line.
 *
 * Why it exists: the learner and the chat read the same sentence, so it names the repository folder, the reason and the one step that can help, never a cookie or a statement that anyone is signed in. A run that declared `session: "fresh"` is told to drop that field, not to set up a session it would not use; a session the app keeps only while the browser stays open is set up again only with the app's own keep-me-signed-in choice. Called by {@link ConfiguredBrowserRun} when it fails a run with `SIGN_IN_REQUIRED`.
 * @param reason - Why the page asked: see `SIGN_IN_REQUIRED_REASONS`.
 * @param facts - The repository folder, the landing, the operation and the declared fresh profile.
 * @returns One sentence per reason, or the declared-fresh sentence.
 * @example
 * signInRequiredMessage('no-saved-session', { repositoryName: 'shop' })
 * // => 'The page landed on a sign-in page and shop has no saved session, so the run stopped before it sent anything. Ask the learner to run Codebook: Set Up Saved Session…, then start one new run.'
 * signInRequiredMessage('no-saved-session', { repositoryName: 'shop', landedOn: '/login', declaredFresh: true })
 * // => 'The page landed on /login; the run declared session: "fresh", so it did not use the saved session of shop, and it stopped before it sent anything. For a flow behind sign-in, remove session: "fresh" from the configuration, then start one new run.'
 */
export function signInRequiredMessage(
  reason: SignInRequiredReason,
  facts: SignInRequiredFacts,
): string {
  const { repositoryName } = facts
  const where = facts.landedOn ?? 'a sign-in page'
  const when =
    facts.operationIndex === undefined
      ? 'before it sent anything'
      : `after operation ${facts.operationIndex}`
  const asked = `The page landed on ${where}`
  // A declared fresh profile is the cause whatever the store holds: a setup would not change the next run.
  if (facts.declaredFresh)
    return `${asked}; the run declared session: "fresh", so it did not use the saved session of ${repositoryName}, and it stopped ${when}. For a flow behind sign-in, remove session: "fresh" from the configuration, then start one new run.`
  switch (reason) {
    case 'no-saved-session':
      return `${asked} and ${repositoryName} has no saved session, so the run stopped ${when}. Ask the learner to run Codebook: Set Up Saved Session…, then start one new run.`
    case 'setup-not-finished':
      return `${asked}; the saved-session setup of ${repositoryName} was closed before Done, so the run used a fresh profile and stopped ${when}. Ask the learner to run Codebook: Set Up Saved Session… and finish it with Done, then start one new run.`
    case 'redirected-to-sign-in':
      return `${asked} although the run used the saved session of ${repositoryName}, so the saved session may have expired. The run stopped ${when}. Ask the learner to run Codebook: Set Up Saved Session… again, then start one new run.`
    case 'session-cookie-only':
      return `${asked}: ${repositoryName} keeps its sign-in only while the browser stays open, so a saved session cannot keep it. The run stopped ${when}. Only when the app's sign-in page offers to keep the learner signed in (such as Remember me), ask the learner to set up the saved session again with that choice; otherwise this flow cannot run with a saved session, so do not start another run for it.`
  }
}
