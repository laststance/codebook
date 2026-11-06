import {
  describeSyntax,
  hasShellSyntax,
  KNOWN_RUNNER_WORDS,
} from './parseViteDevScript'

/** The `start` script state of a react-scripts app, in the shape of Vite's `devScript`. */
export type ReactScriptsStartScriptReadiness =
  | { form: 'accepted' }
  | { form: 'refused'; refused: string[] }
  | { form: 'absent' }

/** What {@link parseReactScriptsStartScript} reads: the readiness form and, for an accepted script, its leading assignments. */
export type ReactScriptsStartScriptReading = {
  readiness: ReactScriptsStartScriptReadiness
  /** Leading `NAME=value` assignments of an accepted script; passed to the launcher as an environment object and never through a shell. */
  assignments: Record<string, string>
}

const ASSIGNMENT_WORD = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

/** Longest assignment name echoed in a refusal; a longer name is cut so a status stays small. */
const REFUSED_NAME_MAX_LENGTH = 64

/** Names Codebook sets itself in the child environment; compared upper-cased because Windows environment names are case-insensitive. Written exactly in upper case, `HOST`, `PORT`, `BROWSER` and `CI` are overridden by Codebook's value (`PORT` is also read as the declared port); only another casing would sit beside it. */
const CODEBOOK_OWNED_NAMES = new Set(['HOST', 'PORT', 'BROWSER', 'CI'])

/** Names that change how the app is served, so they are refused in any casing: Codebook probes plain `http` and never sets this one. */
const REFUSED_SERVING_NAMES = new Set(['HTTPS'])

/** A fresh assignments object without a prototype, so a `__proto__=…` word is an ordinary key. */
function emptyAssignments(): Record<string, string> {
  return Object.create(null) as Record<string, string>
}

/** The reading of a refused script: the structural descriptions, and no assignments. */
function refusedReading(refused: string[]): ReactScriptsStartScriptReading {
  return {
    readiness: { form: 'refused', refused },
    assignments: emptyAssignments(),
  }
}

/**
 * Describes why one leading assignment is refused, by its name only, or `undefined` when it is accepted.
 * Called by {@link parseReactScriptsStartScript} for each leading `NAME=value` word.
 * @param name - The assignment's name.
 * @param value - The assignment's value; never echoed.
 * @param ownedNames - The upper-case names the adapter's launcher sets itself.
 * @returns The structural description of the refusal, or `undefined`.
 * @example describeRefusedAssignment('Host', '0.0.0.0', new Set(['HOST'])) // => 'the assignment Host, which Codebook sets itself'
 */
function describeRefusedAssignment(
  name: string,
  value: string,
  ownedNames: ReadonlySet<string>,
): string | undefined {
  const shown = name.slice(0, REFUSED_NAME_MAX_LENGTH)
  // A differently cased twin of Codebook's own variable would sit beside it in the child environment.
  const upper = name.toUpperCase()
  if (
    REFUSED_SERVING_NAMES.has(upper) ||
    (ownedNames.has(upper) && name !== upper)
  )
    return `the assignment ${shown}, which Codebook sets itself`
  if (hasShellSyntax(value) || value.startsWith('~'))
    return `the assignment ${shown} with ${describeSyntax(value, 'a value')}`
  return undefined
}

/**
 * Reads the leading `NAME=value` words of a script as environment assignments and describes each refused one by its name.
 *
 * Why it exists: react-scripts and Expo web both accept a start script of one fixed command after optional assignments, and refuse an assignment of a name the launcher owns, of a serving name or with shell syntax in one grammar. Called by {@link parseReactScriptsStartScript} and {@link parseExpoWebScript}.
 * @param words - The script's words.
 * @param ownedNames - The upper-case names the adapter's launcher sets itself.
 * @returns The accepted assignments (no prototype), the structural descriptions of the refused ones and the index of the first word that is no assignment.
 * @example readLeadingAssignments(['PORT=4000', 'react-scripts', 'start'], new Set(['PORT'])).index // => 1
 */
export function readLeadingAssignments(
  words: readonly string[],
  ownedNames: ReadonlySet<string>,
): { assignments: Record<string, string>; refused: string[]; index: number } {
  const assignments = emptyAssignments()
  const refused: string[] = []
  let index = 0
  // Leading NAME=value words are environment assignments; a refused one refuses the whole script.
  for (; index < words.length; index += 1) {
    const match = ASSIGNMENT_WORD.exec(words[index]!)
    if (!match) break
    const [, name, value] = match
    const description = describeRefusedAssignment(name!, value!, ownedNames)
    if (description) refused.push(description)
    else assignments[name!] = value!
  }
  return { assignments, refused, index }
}

/**
 * Describes a script's command word when it is not the one command the adapter accepts, echoing only known grammar words.
 *
 * Why it exists: react-scripts and Expo web refuse every other command word with the same structural description. Called by {@link describeRestOfScript} and {@link parseExpoWebScript}.
 * @param command - The first word after the assignments, if any.
 * @param expected - The command word the adapter accepts (`react-scripts`, `expo`).
 * @returns The refused elements, or `undefined` when the command is the expected one.
 * @example describeForeignCommand('cross-env', 'expo') // => ['the command word cross-env']
 */
export function describeForeignCommand(
  command: string | undefined,
  expected: string,
): string[] | undefined {
  if (command === undefined || command === '')
    return [`an empty command (the script must start with ${expected})`]
  if (command === expected) return undefined
  if (KNOWN_RUNNER_WORDS.has(command)) return [`the command word ${command}`]
  if (hasShellSyntax(command)) return [describeSyntax(command, 'a word')]
  return [`the command word … (the script must start with ${expected})`]
}

/**
 * Describes the part of a script after its assignments by structure, echoing only known grammar words.
 * @param rest - The words after the leading assignments.
 * @returns The refused elements; empty for exactly `react-scripts start`.
 * @example describeRestOfScript(['cross-env', 'react-scripts', 'start']) // => ['the command word cross-env']
 */
function describeRestOfScript(rest: string[]): string[] {
  const [command, subcommand, ...extra] = rest
  const foreign = describeForeignCommand(command, 'react-scripts')
  if (foreign) return foreign
  const refused: string[] = []
  if (subcommand !== 'start')
    refused.push('react-scripts with a command other than start')
  if (extra.length > 0) refused.push('extra words after react-scripts start')
  return refused
}

/**
 * Reads the `start` script of a react-scripts app: accepted only as exactly `react-scripts start`, optionally preceded by `NAME=value` assignments.
 *
 * Why it exists: Codebook runs the app's installed `start.js` directly, so any other form (`cross-env`, extra arguments, a wrapper) would be silently skipped; it is listed as refused instead. Called by {@link readReactScriptsPackageReadiness}.
 *
 * @param script - The manifest's `scripts.start` value, `undefined` when there is none.
 * @returns
 * - `absent` readiness for no script
 * - `accepted` readiness with the assignments for the accepted form
 * - `refused` readiness describing every refused element by structure (command words, assignment names, character classes), never an assignment value or operand, because status and refusals publish it
 * @example
 * parseReactScriptsStartScript('PORT=4000 react-scripts start') // => { readiness: { form: 'accepted' }, assignments: { PORT: '4000' } }
 * parseReactScriptsStartScript('API_TOKEN=abc cross-env react-scripts start') // => { readiness: { form: 'refused', refused: ['the command word cross-env'] }, assignments: {} }
 */
export function parseReactScriptsStartScript(
  script: unknown,
): ReactScriptsStartScriptReading {
  if (script === undefined)
    return { readiness: { form: 'absent' }, assignments: emptyAssignments() }
  if (typeof script !== 'string')
    return refusedReading(['a start script that is not text'])
  const words = script.trim().split(/\s+/)
  const { assignments, refused, index } = readLeadingAssignments(
    words,
    CODEBOOK_OWNED_NAMES,
  )
  refused.push(...describeRestOfScript(words.slice(index)))
  return refused.length > 0
    ? refusedReading([...new Set(refused)])
    : { readiness: { form: 'accepted' }, assignments }
}
