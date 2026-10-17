import { isWikiUpdateSign, type WikiUpdatePlaces } from './isWikiUpdateSign'

/** What disposes one of the editor's listeners. */
type SignWatch = { dispose(): void }

/** The two events of the editor a sign of an update can come from: a document it opened and a command a terminal started, each as the editor's API hands it to a listener. */
export type WikiUpdateSignEvents = {
  onDidOpenTextDocument: (
    listener: (document: { uri: { scheme: string; fsPath: string } }) => void,
  ) => SignWatch
  onDidStartTerminalShellExecution: (
    listener: (event: {
      execution: { commandLine: { value: string } }
    }) => void,
  ) => SignWatch
}

/**
 * Listens to the editor for the signs that the chat works on a Wiki update; called by the extension as the `watchSigns` of {@link startWikiChatUpdate}, for the time of the wait for the first answer.
 *
 * Why: a chat that reads a file or runs a command without asking for a confirmation says nothing to the command that sent the request; the editor reports the document (`workspace.onDidOpenTextDocument`) and the command line (`window.onDidStartTerminalShellExecution`). Both events are those of the whole window, so each is weighed by {@link isWikiUpdateSign}; a document that is no file (an output channel, an untitled buffer, a chat's code block) is nobody's read of the Wiki.
 *
 * @param events - The editor's two events.
 * @param places - The Wiki's output folder and the bundled skill's folder.
 * @param reportSign - Called for each document or command that belongs to the update.
 * @returns The two listeners' disposables.
 * @throws What the editor throws when a listener cannot be registered; the listener registered before it is disposed first.
 * @example
 * const watches = watchWikiUpdateSigns({ onDidOpenTextDocument: vscode.workspace.onDidOpenTextDocument, onDidStartTerminalShellExecution: vscode.window.onDidStartTerminalShellExecution }, places, reportSign)
 * // reportSign runs once the chat opens '<output>/codebook-wiki.json'
 */
export function watchWikiUpdateSigns(
  events: WikiUpdateSignEvents,
  places: WikiUpdatePlaces,
  reportSign: () => void,
): SignWatch[] {
  /** Reports what the editor saw when it belongs to the update. */
  const weigh = (candidate: Parameters<typeof isWikiUpdateSign>[0]): void => {
    if (isWikiUpdateSign(candidate, places)) reportSign()
  }
  const watches: SignWatch[] = []
  try {
    watches.push(
      events.onDidOpenTextDocument((document) => {
        // Only a file can be the manifest, the skill or a prepared page.
        if (document.uri.scheme === 'file')
          weigh({ kind: 'document', path: document.uri.fsPath })
      }),
    )
    watches.push(
      events.onDidStartTerminalShellExecution((event) => {
        weigh({
          kind: 'command',
          commandLine: event.execution.commandLine.value,
        })
      }),
    )
    return watches
  } catch (error) {
    // A listener that could not be registered leaves none behind.
    for (const watch of watches) watch.dispose()
    throw error
  }
}
