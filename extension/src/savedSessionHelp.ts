import {
  SIGN_IN_PATH_LIMIT,
  SIGN_IN_REQUIRED_REASONS,
  SIGN_IN_SETUP_TIMEOUT_MS,
} from './constants'
import { describeMinutes } from './utils/describeMinutes'

/**
 * Builds the "Set up a saved session" section of `codebook://help/repository-browser`: what the saved session is, what it keeps, where it lives, how to remove it, and how the chat waits for the learner and how a version 3 run uses the session and when it refuses (DX-6, DX-9, DX-10, DX-11). The confirmation before operation 1 is linked, not repeated.
 *
 * Why it exists: a chat that meets `SIGN_IN_REQUIRED` must tell the learner exactly what to do and must never try to sign in itself; the error codes themselves are rows of the operations error table ({@link OPERATIONS_ERROR_CODES}), so this section holds only the prose.
 * Called by the resource reader for the repository-browser help, which spreads it after {@link operationsHelp}.
 *
 * @returns The key `savedSession` to spread into the help object.
 * @example
 * const help = { ...operationsHelp(), ...savedSessionHelp() }
 * help.savedSession.anchor // => 'codebook://help/repository-browser#set-up-a-saved-session'
 */
export function savedSessionHelp() {
  return {
    savedSession: {
      anchor: 'codebook://help/repository-browser#set-up-a-saved-session',
      summary:
        "A version 3 run starts with the learner's saved session for this repository once the learner has set one up with Codebook: Set Up Saved Session… and finished with Done. The learner signs in by hand in a Codebook browser window that is never recorded; Codebook never sees, stores or types the password. Never type, ask for or accept a password to get past sign-in.",
      whatIsKept:
        "The saved session keeps what that browser keeps for the app: cookies, local storage, IndexedDB, and an OAuth provider's session (for example GitHub) when the sign-in went through one. Password saving is turned off, so no password is stored.",
      where:
        "One folder per editor and repository, private to the user (mode 0700 on macOS and Linux), in the editor's global storage for Codebook (sign-in-profiles). It is never in the repository, the VSIX, a recording or evidence. Chrome protects its cookies there with the operating system's credential store where one is available.",
      remove:
        "Codebook: Remove Saved Session… deletes the folder directly, not to the Trash, because it holds the app's sign-in cookies. While a run uses it, the removal offers Stop run and remove.",
      status:
        'codebook_status.savedSession is { available, state, setupAt }. state is none, setup-open, saved, unconfirmed (setup closed without Done) or unusable, and setupAt is when the last setup ended. Codebook never checks whether the app still has the learner signed in: a run that lands on one of signInPaths answers SIGN_IN_REQUIRED.',
      waiting:
        'After you relay SIGN_IN_REQUIRED, read codebook_status at most every 10 s for at most 5 minutes. Start one new run only when savedSession.state is saved with a newer setupAt; otherwise stop and tell the learner what to do. A second SIGN_IN_REQUIRED for the same repository without a newer setupAt: stop and ask the learner.',
      confirmation:
        'Before operation 1 of a run that uses the saved session the learner confirms the operations in an editor dialog: see codebook://help/repository-browser#saved-session-confirmation.',
      setup: `Codebook starts the app, opens its own Chrome window at the sign-in page and shows Done and Close setup. Close setup, closing the window or ${describeMinutes(SIGN_IN_SETUP_TIMEOUT_MS)} without Done keep what the browser saved, but runs do not use it until a later Done.`,
      runs: 'A version 3 run of a repository with a saved session starts with it: Codebook\'s own Chrome opens the repository\'s saved-session folder, in VS Code and in Cursor alike, so the app keeps the data the saved session already had. The run resource reads session: "saved", appState: "kept" and savedSession { available, state, setupAt }; codebook_status holds the current value. Versions 1 and 2 always start with a fresh profile and never check for a sign-in page.',
      signInPaths: `For a flow behind sign-in, declare signInPaths: 1 to ${SIGN_IN_PATH_LIMIT} absolute paths without a query, such as ["/login"], read from the app's own sign-in route (its proxy or middleware, its auth configuration), never guessed. When the page lands on one of them, at the entry load or after an operation, the run ends with SIGN_IN_REQUIRED before anything more is sent. A path is compared with location.pathname after one trailing slash is removed, so /login/ and /login?callbackUrl=… match /login. A locale-prefixed path such as /en/login needs its own entry. The entry path itself cannot be a sign-in path: leave signInPaths out to explain the sign-in page.`,
      reasons: `SIGN_IN_REQUIRED carries details.reason, one of ${SIGN_IN_REQUIRED_REASONS.join(', ')}. no-saved-session: none is set up, or the run declared session: "fresh". setup-not-finished: the last setup was closed before Done. redirected-to-sign-in: the run used the saved session and the app still asked, so it may have expired. session-cookie-only: the app keeps its sign-in only while the browser stays open, so a saved session cannot keep it. Relay the editor's step to the learner. Never type a password to get past sign-in, and never resume the refused run.`,
      lastOperation:
        "A run whose last operation lands on a sign-in page, such as a sign-out flow, completes when the run's after conditions hold there; where they do not hold, the run answers SIGN_IN_REQUIRED. A run that signs out also ends the saved session: the learner sets it up again before the next run that needs it.",
      fresh:
        'Declare session: "fresh" to run without the saved session even when one exists; the run then reads session: "fresh" and asks for no confirmation. Never use it to get around a sign-in refusal.',
      oneRun:
        "Only one run at a time uses a repository's saved session, in any editor window. A second start answers BUSY with reason profile-in-use, whose details.heldBy reads run (another run uses it) or removal (the learner is removing it), and a start while a setup is open answers SIGN_IN_IN_PROGRESS. A Chrome that still holds the saved-session folder answers SIGN_IN_PROFILE_IN_USE. Codebook never unlocks a folder another process holds.",
      origin:
        'The saved session opens only on the loopback origin of the development server Codebook starts (http://localhost:<port>); any other origin answers SIGN_IN_ORIGIN_REFUSED. It is used only by a Chrome that is not older than the one that set it up; otherwise a run answers SIGN_IN_PROFILE_UNUSABLE with reason chrome-version.',
      entryLoad:
        "Codebook's own server check of the entry path carries no cookies. When it is redirected to a declared sign-in path, a run without a saved session is refused with SIGN_IN_REQUIRED before the browser opens, and a run with the saved session first loads the entry page once in its browser, so the route is compiled before the stops are sealed. The page's load code therefore runs twice. A Pages-router route behind sign-in is not supported in this version.",
      recording:
        'Frames and page text of the saved account are recorded as the browser shows them; only secret text and secret-named values are masked. Use a local test account.',
    },
  }
}
