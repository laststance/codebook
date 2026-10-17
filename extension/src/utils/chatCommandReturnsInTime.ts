import { waitWithin, type BoundedWait } from './waitWithin'

/**
 * Runs one command of the editor chat and says whether it returned in time, so a command that an editor does not have, that fails or that never returns cannot hold a Wiki update; called for each command around the hand-over of the update request ({@link handWikiRequestToChat}) and of its withdrawal ({@link withdrawWikiChatRequest}).
 * @param command - The editor command to run without arguments.
 * @param runChatCommand - Runs an editor command.
 * @param wait - The bound of the command's return; after an abort no command is started.
 * @returns `true` when the command returned within the bound; `false` when it threw (also for a command the editor does not have), did not return in time, or the signal had aborted before it or aborted meanwhile.
 * @example
 * await chatCommandReturnsInTime('workbench.action.chat.cancel', run, wait) // => false for an editor without the command
 */
export async function chatCommandReturnsInTime(
  command: string,
  runChatCommand: (command: string) => PromiseLike<unknown>,
  wait: BoundedWait,
): Promise<boolean> {
  // After an abort (the window closes) no further command is started.
  if (wait.signal.aborted) return false
  const didReturn = await waitWithin(
    Promise.resolve()
      .then(() => runChatCommand(command))
      .then(
        () => true,
        () => false,
      ),
    wait,
  )
  return didReturn === true
}
