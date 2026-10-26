import { WIKI_CHAT_OPEN_TIMEOUT_MS } from '../constants'

import { wikiRunBoundMs } from './wikiRunBoundMs'
import type { WikiRunKind, WikiUpdateHost } from './wikiUpdateRun'

/**
 * Names the longest a run of one kind and host can last from its marker's start to its end; called by the marker reader for a run's marker that may have expired.
 * @param runKind - The run's kind; `undefined` reads as an update.
 * @param host - The editor host that runs it.
 * @returns The Cursor agent's bound, or in VS Code the chat's opening ({@link WIKI_CHAT_OPEN_TIMEOUT_MS}) and the watch's bound.
 * @example
 * longestWikiRunMs('generate', 'vscode') // => 3_330_000
 * longestWikiRunMs('update', 'cursor')   // => 900_000
 */
export function longestWikiRunMs(
  runKind: WikiRunKind | undefined,
  host: WikiUpdateHost,
): number {
  // A VS Code run first waits for the chat to open, then watches for the publish.
  return host === 'cursor'
    ? wikiRunBoundMs(runKind, host)
    : WIKI_CHAT_OPEN_TIMEOUT_MS + wikiRunBoundMs(runKind, host)
}
