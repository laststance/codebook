import { StudyError } from '../errors'

import { messageNamingCause } from './messageNamingCause'
import { withoutErrorName } from './withoutErrorName'

/** The private roots a cause must not show, with the words that replace them. */
export type CauseRoots = {
  /** The extension's storage folders (the service's storage root, the learning directory); each reads `<storage>`. */
  storage: readonly string[]
  /** The opened repository's root, as reported and by its real path when they differ (a symlinked workspace); each reads `<workspace>`. */
  workspace?: string | readonly string[]
  /** The user's home directory, as reported and by its real path when they differ; each reads `~`. */
  home?: string | readonly string[]
}

/** C0 and C1 control characters, DEL, and the bidirectional controls that can reorder what a reader sees. */
const CONTROL_CHARACTERS =
  /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

/** Folders macOS shows under two names, `/var` beside `/private/var` and `/tmp` beside `/private/tmp`; a realpath gives one and a message the other. */
const REALPATH_ALIASES: readonly (readonly [string, string])[] = [
  ['/private/var/', '/var/'],
  ['/private/tmp/', '/tmp/'],
]

/** A Windows root: a drive letter, optionally behind the `\\?\` prefix, with either separator. */
const WINDOWS_ROOT = /^(?:\\\\\?\\)?[A-Za-z]:[\\/]/

/**
 * Escapes every regular-expression character of a literal.
 * @param text - The literal.
 * @returns The literal as a pattern that matches only itself.
 * @example literal('C:\\Users') // => 'C:\\\\Users'
 */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Gives every spelling a root can appear in: as given, through a macOS realpath alias, and for a Windows root with either separator and with or without the `\\?\` prefix.
 * @param root - A root as the extension knows it.
 * @returns The patterns that match the root, each ending before the root's own last separator.
 * @example rootPatterns('/private/var/folders/x') // => [/\/private\/var\/folders\/x/g, /\/var\/folders\/x/g]
 */
function rootPatterns(root: string): RegExp[] {
  const trimmed = root.replace(/[\\/]+$/, '')
  if (!trimmed) return []
  // A root must begin and end where a path segment does, so /Users/ada never matches inside /Users/adam, nor /var inside /private/var.
  const start = '(?<![A-Za-z0-9._-])'
  // A period ends a root when a sentence does (`… in /Users/ada/code.`); a period before a name character (`.ts`, `.d`) continues the name.
  const boundary = '(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])'
  if (WINDOWS_ROOT.test(`${trimmed}\\`)) {
    const bare = trimmed.replace(/^\\\\\?\\/, '')
    const pattern = bare
      .split(/[\\/]+/)
      .map(literal)
      .join('[\\\\/]+')
    // Windows paths compare without regard to case, and a long-path prefix may stand before the drive.
    return [
      new RegExp(`${start}(?:\\\\\\\\\\?\\\\)?${pattern}${boundary}`, 'gi'),
    ]
  }
  const spellings = new Set([trimmed])
  for (const [left, right] of REALPATH_ALIASES) {
    if (`${trimmed}/`.startsWith(left))
      spellings.add(right + `${trimmed}/`.slice(left.length).replace(/\/$/, ''))
    if (`${trimmed}/`.startsWith(right))
      spellings.add(left + `${trimmed}/`.slice(right.length).replace(/\/$/, ''))
  }
  // The longest spelling first, so /private/var/… is replaced whole before /var/… could match inside it.
  return [...spellings]
    .sort((left, right) => right.length - left.length)
    .map(
      (spelling) => new RegExp(`${start}${literal(spelling)}${boundary}`, 'g'),
    )
}

/**
 * Words a failure's cause for a tooltip, a notification, the run resource, an MCP message and the Output › Codebook channel without the private paths it can carry, at the moment the cause is assigned, so every surface shows the same value; called by {@link StudyService} for a test history's failure, the test run's recording reason and the `HISTORY_SEAL_FAILED` cause, by {@link NodeLearningSave} for the save's causes, by {@link StudyWorkspace} for the causes it reports, and by {@link NodeTestHistoryStore} for an unavailable history's reason.
 * The extension's storage roots read `<storage>`, the opened repository's root `<workspace>` and the home directory `~`, in POSIX and Windows forms (either separator, the `\\?\` prefix, any case on Windows) and through the macOS realpath aliases `/var` and `/private/var`. A {@link StudyError} reads as its message naming its cause ({@link messageNamingCause}); any other error loses its leading error name ({@link withoutErrorName}). Control characters, bidirectional ones included, become spaces. The whole text is returned; a surface cuts it for display ({@link cutCauseForDisplay}).
 * @param error - What was thrown, or a cause already in words.
 * @param roots - The private roots of this window.
 * @returns The sanitized cause.
 * @example
 * sanitizeCause(new Error("ENOSPC: no space left on device, write '/Users/ada/Library/Application Support/Code/User/workspaceStorage/x/events.jsonl'"), { storage: ['/Users/ada/Library/Application Support/Code/User/workspaceStorage/x'], home: '/Users/ada' })
 * // => 'ENOSPC: no space left on device, write \'<storage>/events.jsonl\''
 * sanitizeCause('EACCES C:\\Users\\Ada\\repo\\a.ts', { storage: [], workspace: 'C:\\Users\\Ada\\repo', home: 'C:\\Users\\Ada' })
 * // => 'EACCES <workspace>\\a.ts'
 */
export function sanitizeCause(error: unknown, roots: CauseRoots): string {
  let text =
    error instanceof StudyError
      ? messageNamingCause(error.message, error.causeDetail)
      : withoutErrorName(String(error))
  const replacements: [string, string][] = roots.storage.map(
    (root): [string, string] => [root, '<storage>'],
  )
  for (const root of [roots.workspace ?? []].flat())
    replacements.push([root, '<workspace>'])
  for (const root of [roots.home ?? []].flat()) replacements.push([root, '~'])
  // The longest root first, so a storage folder inside the home directory reads <storage>, not ~/….
  replacements.sort((left, right) => right[0].length - left[0].length)
  for (const [root, words] of replacements)
    for (const pattern of rootPatterns(root))
      text = text.replace(pattern, words)
  return text.replace(CONTROL_CHARACTERS, ' ').replace(/ {2,}/g, ' ').trim()
}
