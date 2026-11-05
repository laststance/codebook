import { NODE_SERVER_MODAL_RUN_ID_CHARS } from '../constants'
import type { NodeScriptRunQuestion } from '../ownedNodeScriptRun'

import type { ShowModalQuestion } from './askToSendStateChangingRequest'

/** The label of the dialog's one button; the editor adds Cancel itself. */
export const RUN_SCRIPT_LABEL = 'Run once'

/**
 * Makes the question the environment asks before a node-script run is spawned: a native modal that names the script, its package folder and the run, and says the script does whatever it does and may change files, databases or remote services. The chat AI cannot answer it.
 * Each dialog is its own question with its own wait, so an answer belongs only to the run that asked. The editor offers no way to close a modal, so one whose run stopped waiting (no answer within the pause hold, a stop) stays on screen; its late **Run once** starts nothing and shows a notice that the run already ended.
 * Called once by the environment for the window's life; the script run awaits the result before it spawns anything.
 * @param show - The editor's modal question ({@link ShowModalQuestion}).
 * @param notifyEnded - Shows the notice for a late answer; receives the run's short id.
 * @returns The asker: `(question, signal)` resolves `true` only when the learner chose **Run once** while the run still waited; `false` for Cancel, a dismissal, or an abort (also one that came first, which shows no modal).
 * @example
 * const ask = createNodeScriptRunAsker(show, notify)
 * await ask({ runId: 'r1', entry: 'check.mjs', packageRoot: '.' }, signal) // => true after Run once
 */
export function createNodeScriptRunAsker(
  show: ShowModalQuestion,
  notifyEnded: (shortRunId: string) => void,
) {
  return async (
    question: NodeScriptRunQuestion,
    signal: AbortSignal,
  ): Promise<boolean> => {
    if (signal.aborted) return false
    const shortRunId = question.runId.slice(0, NODE_SERVER_MODAL_RUN_ID_CHARS)
    let waiting = true
    const answered = Promise.resolve(
      show(
        `Run ${question.entry} once?`,
        `Codebook will run the repository's script ${question.entry} (package folder ${question.packageRoot}) once, under the debugger, for run ${shortRunId}. The script does whatever it does: it may change files, databases or remote services. Run it only if that is safe here. If this question stays after Codebook gave up waiting, Cancel it: an answer to it starts nothing.`,
        RUN_SCRIPT_LABEL,
      ),
    ).then((choice) => {
      const accepted = choice === RUN_SCRIPT_LABEL
      // A dialog whose run stopped waiting still gets its answer; it only says the run is over.
      if (!waiting && accepted) notifyEnded(shortRunId)
      return accepted && waiting
    })
    let onAbort = (): void => undefined
    const aborted = new Promise<false>((resolve) => {
      onAbort = (): void => {
        waiting = false
        resolve(false)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return await Promise.race([answered, aborted])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}
