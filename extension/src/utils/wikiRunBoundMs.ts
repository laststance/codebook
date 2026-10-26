import {
  WIKI_CHAT_OPEN_TIMEOUT_MS,
  WIKI_CURSOR_UPDATE_TIMEOUT_MS,
  WIKI_GENERATE_TIMEOUT_MS,
  WIKI_UPDATE_WATCH_TIMEOUT_MS,
} from '../constants'

import type { WikiRunKind, WikiUpdateHost } from './wikiUpdateRun'

/**
 * Names the bound of one LLM Wiki run by its kind and host, wherever a bound is read: the run's own stop, a stopped VS Code watch's reservation and its release timer, the leftover admission of the next start.
 * Why: a generation runs up to {@link WIKI_GENERATE_TIMEOUT_MS} in both hosts, longer than an update's bounds; a place that read the update's bound for a generation would free its marker or its reservation while its agent still works (Cycle 0055, Eng decision 74).
 * @param runKind - The run's kind; `undefined` for a marker or a record an earlier version wrote, which only updated.
 * @param host - The editor host that runs it.
 * @param bounds - The three bounds; the extension passes the constants it reads itself, which a host test may shorten.
 * @returns
 * - A generation: {@link WIKI_GENERATE_TIMEOUT_MS} in both hosts
 * - An update: {@link WIKI_CURSOR_UPDATE_TIMEOUT_MS} in Cursor, {@link WIKI_UPDATE_WATCH_TIMEOUT_MS} in VS Code
 * @example
 * wikiRunBoundMs('generate', 'vscode') // => 3_300_000
 * wikiRunBoundMs(undefined, 'cursor')  // => 900_000
 */
export function wikiRunBoundMs(
  runKind: WikiRunKind | undefined,
  host: WikiUpdateHost,
  bounds: {
    generateMs: number
    cursorUpdateMs: number
    watchedUpdateMs: number
  } = {
    generateMs: WIKI_GENERATE_TIMEOUT_MS,
    cursorUpdateMs: WIKI_CURSOR_UPDATE_TIMEOUT_MS,
    watchedUpdateMs: WIKI_UPDATE_WATCH_TIMEOUT_MS,
  },
): number {
  // A generation has one bound in both hosts; an update keeps each host's own.
  if (runKind === 'generate') return bounds.generateMs
  return host === 'cursor' ? bounds.cursorUpdateMs : bounds.watchedUpdateMs
}

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

/** The longest any run of any kind and host can last ({@link longestWikiRunMs}); a marker file whose kind cannot be read counts this long, never the update's shorter bound. */
export const LONGEST_WIKI_RUN_MS = Math.max(
  ...(['generate', 'update'] as const).flatMap((runKind) =>
    (['vscode', 'cursor'] as const).map((host) =>
      longestWikiRunMs(runKind, host),
    ),
  ),
)
