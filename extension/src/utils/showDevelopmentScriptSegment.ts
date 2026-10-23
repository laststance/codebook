import {
  DEVELOPMENT_SCRIPT_NAME_SHOWN_MAX_CHARS,
  DEVELOPMENT_SCRIPT_SHOWN_FLAGS,
  DEVELOPMENT_SCRIPT_SHOWN_WORDS,
} from '../constants'

import { stripTerminalControls } from './stripTerminalControls'

/** The name of an assignment that may be shown: a plain identifier of at most 32 characters. */
const PLAIN_ASSIGNMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/

/**
 * Words a `package.json` script name for the run resource: terminal controls and control characters removed, then cut to {@link DEVELOPMENT_SCRIPT_NAME_SHOWN_MAX_CHARS} characters (D72 rule 2).
 *
 * Called by {@link showDevelopmentScriptWord} and by {@link readDeclaredDevelopmentPort} for the script a delegation names.
 *
 * @param name - A key of the project's `scripts`.
 * @returns The name with no control character, at most {@link DEVELOPMENT_SCRIPT_NAME_SHOWN_MAX_CHARS} characters, `…` marking a cut.
 *
 * @example
 * ```ts
 * showScriptName('web\n\u001b[31m') // 'web[31m'
 * ```
 */
export function showScriptName(name: string): string {
  // Control characters (also the C1 range) never reach a resource text.
  const plain = stripTerminalControls(name).replace(
    /[\u0000-\u001f\u007f-\u009f]/g,
    '',
  )
  const characters = Array.from(plain)
  return characters.length > DEVELOPMENT_SCRIPT_NAME_SHOWN_MAX_CHARS
    ? `${characters.slice(0, DEVELOPMENT_SCRIPT_NAME_SHOWN_MAX_CHARS).join('')}…`
    : plain
}

/** Shows a flag by its name only when the grammar lists it: `--port=4000` is `--port=…`, `-p4000` is `-p…`; an unlisted flag is `…` (D72 rule 2). */
function showFlag(word: string): string {
  const long = word.startsWith('--')
  const equals = word.indexOf('=')
  const name =
    long && equals >= 0
      ? word.slice(0, equals)
      : word.slice(0, long ? undefined : 2)
  if (!DEVELOPMENT_SCRIPT_SHOWN_FLAGS.has(name)) return '…'
  if (long) return equals < 0 ? name : `${name}=…`
  return word.length === 2 ? name : `${name}…`
}

/** Shows an assignment by its name: `PORT=…`, `NAME=…` for a plain identifier, `…=…` for any other name (D72 rule 2). */
function showAssignment(name: string): string {
  if (name === 'PORT') return 'PORT=…'
  return PLAIN_ASSIGNMENT_NAME.test(name) ? `${name}=…` : '…=…'
}

/** The words after which an assignment word can still follow (D72 rule 2). */
const PREFIX_WORDS: ReadonlySet<string> = new Set([
  'export',
  'cross-env',
  'env',
])

/**
 * Shows an assignment word of the prefix (before the program, or after `export`, `cross-env` or `env`) by its name; `undefined` when the word is no assignment there, or its value is empty or only `=` (a base64 padding such as `dXNlcjpwdw==` is an operand, F496).
 */
function showPrefixAssignment(word: string): string | undefined {
  const equals = word.indexOf('=')
  if (equals <= 0 || word.startsWith('-')) return undefined
  const value = word.slice(equals + 1)
  return /^=*$/.test(value) ? '…' : showAssignment(word.slice(0, equals))
}

/**
 * Shows one word of an unread `dev` script (D72 rule 2): a flag name from the grammar's list, an assignment name in an assignment position, the base name of a grammar word or of a script of the `package.json`; every other word, value or operand is `…`.
 *
 * @param word - A word of the unread statement, quotes removed.
 * @param scripts - The project's `scripts`, whose names may be shown.
 * @param inPrefix - Whether the word stands where an assignment can: before the program or after `export`, `cross-env` or `env`.
 * @returns The text to quote for the word.
 */
function showDevelopmentScriptWord(
  word: string,
  scripts: Record<string, unknown> | undefined,
  inPrefix = false,
): string {
  if (word.startsWith('-')) return showFlag(word)
  if (inPrefix) {
    const assignment = showPrefixAssignment(word)
    if (assignment !== undefined) return assignment
  }
  // Any other word that holds `=` is an operand: shown as `…`, never by its text before the `=`.
  if (word.includes('=')) return '…'
  if (Object.hasOwn(scripts ?? {}, word)) return showScriptName(word)
  // A program is shown by its base name, never by the folders before it.
  const base = word.slice(word.lastIndexOf('/') + 1)
  if (DEVELOPMENT_SCRIPT_SHOWN_WORDS.has(base)) return base
  return Object.hasOwn(scripts ?? {}, base) ? showScriptName(base) : '…'
}

/**
 * Shows the words of an unread `dev` script statement by their structure only (D72 rule 2); see {@link showDevelopmentScriptWord}.
 *
 * Called by {@link readDeclaredDevelopmentPort} when it reports why Next's default port was taken.
 *
 * @example
 * ```ts
 * showDevelopmentScriptSegment(['turbo', 'run', 'dev', '--token=abc'], undefined) // '… run dev …'
 * ```
 */
export function showDevelopmentScriptSegment(
  words: readonly string[],
  scripts: Record<string, unknown> | undefined,
): string {
  let inPrefix = true
  return words
    .map((word) => {
      const shown = showDevelopmentScriptWord(word, scripts, inPrefix)
      // The prefix ends at the first word that is neither an assignment nor a wrapper.
      inPrefix =
        inPrefix &&
        (PREFIX_WORDS.has(word) ||
          (!word.startsWith('-') && shown.endsWith('=…')))
      return shown
    })
    .join(' ')
}
