import { StudyError } from '../errors'

import { messageNamingCause } from './messageNamingCause'
import { redactSecretText } from './redactSecretText'
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

/**
 * Measures a root as its macOS realpath alias's short form spells it, so that a root named by both spellings sorts as one root.
 * Why: {@link sanitizeCause} replaces the longest root first; the long spelling (`/private/var/…`) would otherwise outrank a storage folder inside the same root (F214).
 * Called by {@link sanitizeCause} when it orders its roots.
 * @param root - A root as a cause's roots name it.
 * @returns Its length, less the extra characters of a long alias spelling.
 * @example shortSpellingLength('/private/var/folders/ab') // => 15, the length of '/var/folders/ab'
 */
function shortSpellingLength(root: string): number {
  for (const [long, short] of REALPATH_ALIASES)
    if (`${root}/`.startsWith(long))
      return root.length - (long.length - short.length)
  return root.length
}

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
 * Gives the spellings a POSIX root can appear in: as given and through each macOS realpath alias.
 * @param trimmed - A root without a trailing separator.
 * @returns The root's spellings, as given first.
 * @example posixSpellings('/private/var/x') // => ['/private/var/x', '/var/x']
 */
function posixSpellings(trimmed: string): string[] {
  const spellings = new Set([trimmed])
  for (const [left, right] of REALPATH_ALIASES) {
    if (`${trimmed}/`.startsWith(left))
      spellings.add(right + `${trimmed}/`.slice(left.length).replace(/\/$/, ''))
    if (`${trimmed}/`.startsWith(right))
      spellings.add(left + `${trimmed}/`.slice(right.length).replace(/\/$/, ''))
  }
  return [...spellings]
}

/**
 * Gives every literal text {@link hidePrivateRoots} can replace, so a stream can tell which trailing text may still grow into a root: each root as given and through its macOS realpath aliases, and a Windows root without its long-path prefix.
 * Why: {@link createRootHidingStage} holds a trailing run only while it is a prefix of one of these.
 * @param roots - The private roots of this window.
 * @returns The spellings of every root, without trailing separators; empty roots are skipped.
 * @example privateRootSpellings({ storage: [], home: '/Users/ada' }) // => ['/Users/ada']
 */
export function privateRootSpellings(roots: CauseRoots): string[] {
  const all = [
    ...roots.storage,
    ...[roots.workspace ?? []].flat(),
    ...[roots.home ?? []].flat(),
  ]
  return all.flatMap((root) => {
    const trimmed = root.replace(/[\\/]+$/, '')
    if (!trimmed) return []
    if (WINDOWS_ROOT.test(`${trimmed}\\`))
      return [trimmed.replace(/^\\\\\?\\/, '')]
    return posixSpellings(trimmed)
  })
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
  // The longest spelling first, so /private/var/… is replaced whole before /var/… could match inside it.
  return posixSpellings(trimmed)
    .sort((left, right) => right.length - left.length)
    .map(
      (spelling) => new RegExp(`${start}${literal(spelling)}${boundary}`, 'g'),
    )
}

/**
 * Hides a window's private roots in a text and changes nothing else: storage roots read `<storage>`, the opened repository's root `<workspace>` and the home directory `~`, in every spelling {@link sanitizeCause} recognises, the longest root first.
 * Why: a server's response body is data the chat relays as observed; it must lose the learner's paths without the normalization a failure's cause gets (collapsed spaces, joined lines, a removed error name). Called by {@link sanitizeCause} and by the node-server run for the response body it hands to {@link sendDeclaredRequest}.
 * @param text - The text to show.
 * @param roots - The private roots of this window.
 * @returns The text with each root replaced by its words; spacing, line breaks and every other character unchanged.
 * @example
 * hidePrivateRoots('{"file":"/Users/ada/repo/a.ts",  "n": 1}\n', { storage: [], workspace: '/Users/ada/repo', home: '/Users/ada' })
 * // => '{"file":"<workspace>/a.ts",  "n": 1}\n'
 */
export function hidePrivateRoots(text: string, roots: CauseRoots): string {
  return createRootHider(roots)(text)
}

/**
 * Compiles a window's private roots once into a function that hides them, so a caller that hides many texts (a stream, per chunk) sorts the roots and builds each pattern a single time.
 * Why: {@link hidePrivateRoots} rebuilt every pattern per call; {@link createRootHidingStage} calls it several times per output chunk. Called by {@link hidePrivateRoots} and {@link createRootHidingStage}.
 * @param roots - The private roots of this window.
 * @returns A function with the behavior of {@link hidePrivateRoots} for these roots.
 * @example createRootHider({ storage: [], home: '/Users/ada' })('at /Users/ada/a.ts') // => 'at ~/a.ts'
 */
export function createRootHider(roots: CauseRoots): (text: string) => string {
  const replacements: [string, string][] = roots.storage.map(
    (root): [string, string] => [root, '<storage>'],
  )
  for (const root of [roots.workspace ?? []].flat())
    replacements.push([root, '<workspace>'])
  for (const root of [roots.home ?? []].flat()) replacements.push([root, '~'])
  // The longest root first, so a storage folder inside the home directory reads <storage>, not ~/…; an alias spelling counts as its short form, so /private/var/… does not outrank a folder inside it (F214).
  replacements.sort(
    (left, right) =>
      shortSpellingLength(right[0]) - shortSpellingLength(left[0]),
  )
  const compiled = replacements.flatMap(([root, words]) =>
    rootPatterns(root).map((pattern): [RegExp, string] => [pattern, words]),
  )
  return (text) => {
    let hidden = text
    for (const [pattern, words] of compiled)
      hidden = hidden.replace(pattern, words)
    return hidden
  }
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
  const hideRoots = (text: string): string => hidePrivateRoots(text, roots)
  // A domain error's message and cause lose their roots before they are joined and cut, so a cut never leaves part of a root behind (F263).
  const text =
    error instanceof StudyError
      ? messageNamingCause(
          hideRoots(error.message),
          hideRoots(error.causeDetail),
        )
      : hideRoots(withoutErrorName(String(error)))
  // Secret-looking values in a cause are masked last, once control characters can no longer split them.
  return redactSecretText(
    text.replace(CONTROL_CHARACTERS, ' ').replace(/ {2,}/g, ' ').trim(),
  )
}
