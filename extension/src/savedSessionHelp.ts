/**
 * Builds the "Set up a saved session" section of `codebook://help/repository-browser`: what the saved session is, what it keeps, where it lives, how to remove it, and how the chat waits for the learner (DX-6, DX-9, DX-10, DX-11).
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
        "One folder per editor and repository, private to the user (mode 0700 on macOS and Linux), in the editor's global storage for Codebook (sign-in-profiles). It is never in the repository, the VSIX, a recording or evidence, and Chrome encrypts its cookies there with the system keychain.",
      remove:
        "Codebook: Remove Saved Session… deletes the folder directly, not to the Trash, because it holds the app's sign-in cookies. While a run uses it, the removal offers Stop run and remove.",
      status:
        'codebook_status.savedSession is { available, state, setupAt }. state is none, setup-open, saved, unconfirmed (setup closed without Done) or unusable, and setupAt is when the last setup ended. Codebook never checks whether the app still has the learner signed in: a run that lands on one of signInPaths answers SIGN_IN_REQUIRED.',
      waiting:
        'After you relay SIGN_IN_REQUIRED, read codebook_status at most every 10 s for at most 5 minutes. Start one new run only when savedSession.state is saved with a newer setupAt; otherwise stop and tell the learner what to do. A second SIGN_IN_REQUIRED for the same repository without a newer setupAt: stop and ask the learner.',
      setup:
        'Codebook starts the app, opens its own Chrome window at the sign-in page and shows Done and Close setup. Close setup, closing the window or 10 minutes without Done keep what the browser saved, but runs do not use it until a later Done.',
      testAccount:
        'Use a local test account. The frames and page text of the app are recorded as shown; only secret text and secret-named values are masked.',
    },
  }
}
