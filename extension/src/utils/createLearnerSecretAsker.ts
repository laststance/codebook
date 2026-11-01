import { SECRET_FRAME_VALUE_COPY_MIN_CHARS } from '../constants'

/** What the editor's input box needs to ask for a secret: masked, titled, and kept open when the focus moves. */
export type LearnerSecretBoxOptions = {
  password: true
  title: string
  prompt: string
  ignoreFocusOut: true
  /** Refuses a value too short for the frame gate to verify, so the box stays open for a valid one. */
  validateInput: (value: string) => string | undefined
}

/** The editor's input box (`vscode.window.showInputBox`), with the cancellation token it closes on. */
export type ShowSecretBox<Token> = (
  options: LearnerSecretBoxOptions,
  token: Token,
) => PromiseLike<string | undefined>

/** A cancellation the box closes on (`vscode.CancellationTokenSource`). */
export type SecretBoxCancellation<Token> = {
  token: Token
  cancel(): void
  dispose(): void
}

/**
 * Makes the question the environment asks the learner for the secret of a `secret: "ask-learner"` operation: the editor's masked input box titled `<repository> · <operation title>`.
 * Why: the chat must never carry a password, so the learner types it in the editor; the service awaits the answer before it hands the secret to the run. The answer is returned to the caller only: it is never logged or kept here.
 * Called once by the environment; the service calls the asker for each ask-learner operation (DX-3).
 * @param show - The editor's input box.
 * @param createCancellation - Makes the cancellation that closes the box when the signal aborts.
 * @returns The asker: `(question, signal)` resolves the typed secret, or `undefined` when the learner dismissed the box or the signal aborted first (also one that came first, which shows no box).
 * @example
 * const ask = createLearnerSecretAsker(showInputBox, () => new CancellationTokenSource())
 * await ask({ runId: 'r1', repository: 'nextjs-dashboard', title: 'Password' }, signal) // => 'secret typed by the learner'
 */
export function createLearnerSecretAsker<Token>(
  show: ShowSecretBox<Token>,
  createCancellation: () => SecretBoxCancellation<Token>,
) {
  return async (
    question: { runId: string; repository: string; title: string },
    signal: AbortSignal,
  ): Promise<string | undefined> => {
    if (signal.aborted) return undefined
    const cancellation = createCancellation()
    const onAbort = (): void => cancellation.cancel()
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await show(
        {
          password: true,
          title: `${question.repository} · ${question.title}`,
          prompt:
            'Codebook types this into the page for the operation your AI chat sent. The chat never sees it.',
          ignoreFocusOut: true,
          // A secret shorter than the frame gate can verify would fail every later image of the recording.
          validateInput: (value) =>
            value.length < SECRET_FRAME_VALUE_COPY_MIN_CHARS
              ? `Codebook needs at least ${SECRET_FRAME_VALUE_COPY_MIN_CHARS} characters to keep a typed secret out of the recording. Use a test account password of ${SECRET_FRAME_VALUE_COPY_MIN_CHARS} or more characters.`
              : undefined,
        },
        cancellation.token,
      )
    } finally {
      signal.removeEventListener('abort', onAbort)
      cancellation.dispose()
    }
  }
}
