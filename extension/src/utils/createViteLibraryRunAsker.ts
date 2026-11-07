import { NODE_SERVER_MODAL_RUN_ID_CHARS } from '../constants'

import { askRunConfirmation } from './askRunConfirmation'
import type { ShowModalQuestion } from './askToSendStateChangingRequest'

/** The label of the dialog's one button; the editor adds Cancel itself. */
export const BUILD_AND_RUN_LABEL = 'Build and run'

/** What the editor's confirmation dialog of a Vite library run names, so the learner decides on exactly this build and run. */
export type ViteLibraryRunQuestion = {
  runId: string
  /** The library's package name. */
  package: string
  /** The declared `library.packageRoot`. */
  packageRoot: string
  /** The repository's package manager name, as the dialog says `<pm> run build`. */
  packageManager: string
  /** The Example's folder, repository-relative. */
  examplePackageRoot: string
}

/**
 * Makes the question the environment asks before a Vite library run builds anything: a native modal that names the library, the package manager, the build folder and the Example, and says the build runs the project's own scripts.
 * The chat AI cannot answer it. Each dialog is its own question with its own wait; a modal whose run stopped waiting stays on screen, and its late **Build and run** starts nothing and shows a notice that the run already ended.
 * Called once by the environment for the window's life; the run awaits the result before it builds or starts anything.
 * @param show - The editor's modal question ({@link ShowModalQuestion}).
 * @param notifyEnded - Shows the notice for a late answer; receives the run's short id.
 * @returns The asker: `(question, signal)` resolves `true` only when the learner chose **Build and run** while the run still waited.
 * @example
 * const ask = createViteLibraryRunAsker(show, notify)
 * await ask({ runId: 'r1', package: '@acme/widgets', packageRoot: 'packages/widgets', packageManager: 'pnpm', examplePackageRoot: 'examples/widgets-vite' }, signal) // => true after Build and run
 */
export function createViteLibraryRunAsker(
  show: ShowModalQuestion,
  notifyEnded: (shortRunId: string) => void,
) {
  return (
    question: ViteLibraryRunQuestion,
    signal: AbortSignal,
  ): Promise<boolean> => {
    const shortRunId = question.runId.slice(0, NODE_SERVER_MODAL_RUN_ID_CHARS)
    return askRunConfirmation(
      show,
      notifyEnded,
      {
        title: `Build ${question.package} and run the Example?`,
        detail: `Codebook will build ${question.package} with ${question.packageManager} run build in ${question.packageRoot} and pack it, then start the Example in ${question.examplePackageRoot} on the packed copy, under the debugger, for run ${shortRunId}. The build runs the project's own build scripts and rewrites its ignored build output. Run it only if that is safe here. If this question stays after Codebook gave up waiting, Cancel it: an answer to it starts nothing.`,
        label: BUILD_AND_RUN_LABEL,
        shortRunId,
      },
      signal,
    )
  }
}
