import { SIGN_IN_PATH_LIMIT, SIGN_IN_REQUIRED_REASONS } from './constants'

/**
 * Builds the part of `codebook://help/repository-browser` that explains how a version 3 web app run uses the learner's saved session and when it refuses.
 *
 * Why it exists: an agent that declares `signInPaths`, reads `SIGN_IN_REQUIRED` or meets a busy saved session needs the run-side rules in one place, beside the setup section. Called by {@link operationsHelp}, which spreads the key into the repository-browser help.
 * @returns The key `operationsSavedSessionRuns`, with one sentence per rule.
 * @example
 * operationsSavedSessionRunsHelp().operationsSavedSessionRuns.anchor // => 'codebook://help/repository-browser#saved-session-runs'
 */
export function operationsSavedSessionRunsHelp() {
  return {
    operationsSavedSessionRuns: {
      anchor: 'codebook://help/repository-browser#saved-session-runs',
      runs: 'A version 3 run of a repository with a saved session starts with it: Codebook\'s own Chrome opens the repository\'s saved-session folder, in VS Code and in Cursor alike, so the app keeps the data the saved session already had. The run resource reads session: "saved", appState: "kept" and savedSession { available, state, setupAt }; codebook_status holds the current value. Versions 1 and 2 always start with a fresh profile and never check for a sign-in page.',
      signInPaths: `For a flow behind sign-in, declare signInPaths: 1 to ${SIGN_IN_PATH_LIMIT} absolute paths without a query, such as ["/login"], read from the app's own sign-in route (its proxy or middleware, its auth configuration), never guessed. When the page lands on one of them, at the entry load or after an operation, the run ends with SIGN_IN_REQUIRED before anything more is sent. A path is compared with location.pathname after one trailing slash is removed, so /login/ and /login?callbackUrl=… match /login. A locale-prefixed path such as /en/login needs its own entry. The entry path itself cannot be a sign-in path: leave signInPaths out to explain the sign-in page.`,
      reasons: `SIGN_IN_REQUIRED carries details.reason, one of ${SIGN_IN_REQUIRED_REASONS.join(', ')}. no-saved-session: none is set up, or the run declared session: "fresh". setup-not-finished: the last setup was closed before Done. redirected-to-sign-in: the run used the saved session and the app still asked, so it may have expired. session-cookie-only: the app keeps its sign-in only while the browser stays open, so a saved session cannot keep it. Relay the editor's step to the learner. Never type a password to get past sign-in, and never resume the refused run.`,
      lastOperation:
        "A run whose last operation lands on a sign-in page, such as a sign-out flow, completes when the run's after conditions hold there; where they do not hold, the run answers SIGN_IN_REQUIRED. A run that signs out also ends the saved session: the learner sets it up again before the next run that needs it.",
      fresh:
        'Declare session: "fresh" to run without the saved session even when one exists; the run then reads session: "fresh" and asks for no confirmation. Never use it to get around a sign-in refusal.',
      oneRun:
        "Only one run at a time uses a repository's saved session, in any editor window. A second start answers BUSY with reason profile-in-use, and a start while a setup is open answers SIGN_IN_IN_PROGRESS. A Chrome that still holds the saved-session folder answers SIGN_IN_PROFILE_IN_USE. Codebook never unlocks a folder another process holds.",
      origin:
        'The saved session opens only on the loopback origin of the development server Codebook starts (http://localhost:<port>); any other origin answers SIGN_IN_ORIGIN_REFUSED. It is used only by a Chrome that is not older than the one that set it up; otherwise a run answers SIGN_IN_PROFILE_UNUSABLE with reason chrome-version.',
      entryLoad:
        "Codebook's own server check of the entry path carries no cookies. When it is redirected to a declared sign-in path, a run without a saved session is refused with SIGN_IN_REQUIRED before the browser opens, and a run with the saved session first loads the entry page once in its browser, so the route is compiled before the stops are sealed. The page's load code therefore runs twice. A Pages-router route behind sign-in is not supported in this version.",
      recording:
        'Frames and page text of the saved account are recorded as the browser shows them; only secret text and secret-named values are masked. Use a local test account.',
    },
  }
}
