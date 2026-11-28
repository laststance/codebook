/**
 * The refusal of a Codebook continue that the debugger did not send: the pause was replaced by a later stop of its thread (`superseded`), or the learner holds a pause of another thread that a continue could release (`learner-pause-elsewhere`).
 * Why it exists: the run tells these two refusals from a failed request. A replaced pause ended by itself and fails nothing; a stop that cannot be continued without releasing the learner's pause stays held for the learner, and the run says why.
 * Thrown by the editor's node-server debugger when the run asks it to resume a pause; caught by the node run's own resumes.
 * @example
 * try {
 *   await debug.resume(pause, signal)
 * } catch (error) {
 *   if (error instanceof NodeServerResumeRefusedError) error.reason // => 'learner-pause-elsewhere'
 * }
 */
export class NodeServerResumeRefusedError extends Error {
  /**
   * @param reason - Why no continue was sent.
   * @param message - The sentence of the refusal.
   */
  constructor(
    readonly reason: 'superseded' | 'learner-pause-elsewhere',
    message: string,
  ) {
    super(message)
  }
}
