import type { WikiUpdateHost } from './wikiUpdateRun'

/** The URI scheme whose editor opens the Wiki reader's source, update and settings links. */
export type WikiEditorScheme = WikiUpdateHost | 'devin'

/**
 * Names the URI scheme of the editor serving this window's Wiki reader.
 *
 * Devin Desktop keeps VS Code-compatible runtime plumbing ({@link WikiUpdateHost}) but registers its own `devin` URI scheme, so only reader/citation links use the devin result; update orchestration keeps the runtime host.
 *
 * @param isDevinHost - Whether activation detected Devin Desktop by `vscode.env.uriScheme`.
 * @param wikiHost - The editor host as Wiki update orchestration names it.
 * @returns `devin` in Devin Desktop, otherwise the runtime host's scheme.
 * @example
 * ```ts
 * wikiEditorSchemeOf(true, 'vscode') // => 'devin'
 * ```
 */
export function wikiEditorSchemeOf(
  isDevinHost: boolean,
  wikiHost: WikiUpdateHost,
): WikiEditorScheme {
  return isDevinHost ? 'devin' : wikiHost
}
