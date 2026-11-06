import { DEVELOPMENT_SERVER_MAX_PORT } from '../constants'

import {
  describeForeignCommand,
  readLeadingAssignments,
  type ReactScriptsStartScriptReadiness,
} from './parseReactScriptsStartScript'

/** The web script state of an Expo app, in the shape of the react-scripts start script. */
export type ExpoWebScriptReadiness = ReactScriptsStartScriptReadiness

/** What {@link parseExpoWebScript} reads: the readiness form and, for an accepted script, its assignments and declared port. */
export type ExpoWebScriptReading = {
  readiness: ExpoWebScriptReadiness
  /** Leading `NAME=value` assignments of an accepted script; passed to the launcher as an environment object and never through a shell. */
  assignments: Record<string, string>
  /** The port of `--port N` or `-p N`, when the accepted script declares one. */
  port?: number
}

/** Names Codebook sets itself in the Expo CLI's environment (E-3); compared upper-cased. */
const EXPO_CODEBOOK_OWNED_NAMES: ReadonlySet<string> = new Set([
  'CI',
  'BROWSER',
  'EXPO_NO_TELEMETRY',
])

/** A port word: digits only, so `--port 08` or `--port 1e3` never reads as a port. */
const PORT_WORD = /^[0-9]{1,5}$/

/**
 * Reads the number after a `--port` or `-p` flag.
 * @param value - The word after the flag, if any.
 * @returns The port, or `undefined` when the word is no number of 1 to 65535.
 * @example readPortWord('4101') // => 4101
 */
function readPortWord(value: string | undefined): number | undefined {
  if (value === undefined || !PORT_WORD.test(value)) return undefined
  const port = Number(value)
  return port >= 1 && port <= DEVELOPMENT_SERVER_MAX_PORT ? port : undefined
}

/**
 * Describes the words after `expo start` by structure and finds the declared port.
 * Called by {@link parseExpoWebScript}.
 * @param flags - The words after `expo start`.
 * @returns The refused elements (empty for `--web` with an optional port) and the port.
 * @example describeExpoFlags(['--web', '--port', '4101']) // => { refused: [], port: 4101 }
 */
function describeExpoFlags(flags: readonly string[]): {
  refused: string[]
  port?: number
} {
  const refused: string[] = []
  let port: number | undefined
  let hasWeb = false
  for (let index = 0; index < flags.length; index += 1) {
    const word = flags[index]!
    const isPortFlag = word === '--port' || word === '-p'
    if (word === '--web' && !hasWeb) hasWeb = true
    else if (isPortFlag && port === undefined) {
      port = readPortWord(flags[(index += 1)])
      // A port that is no number of 1 to 65535 is refused by shape, never echoed.
      if (port === undefined) refused.push(`${word} without a port number`)
    } else refused.push('extra or repeated words after expo start')
  }
  if (!hasWeb) refused.push('expo start without --web')
  return { refused, ...(port === undefined ? {} : { port }) }
}

/**
 * Reads the web script of an Expo app: accepted only as exactly `expo start --web`, with an optional `--port N` or `-p N` (in either order with `--web`), optionally preceded by `NAME=value` assignments.
 *
 * Why it exists: Codebook runs the app's installed Expo CLI directly, so any other form (`cross-env`, extra arguments, a wrapper) would be silently skipped; it is listed as refused instead (E-13). Called by {@link readExpoWebPackageReadiness}.
 * @param script - The manifest's `scripts.web` (else `scripts.start`) value, `undefined` when there is none.
 * @returns
 * - `absent` readiness for no script
 * - `accepted` readiness with the assignments and the declared port for the accepted form
 * - `refused` readiness describing every refused element by structure, never an assignment value or operand, because status and refusals publish it
 * @example
 * parseExpoWebScript('expo start --web --port 4101') // => { readiness: { form: 'accepted' }, assignments: {}, port: 4101 }
 * parseExpoWebScript('cross-env X=1 expo start --web') // => { readiness: { form: 'refused', refused: ['the command word cross-env'] }, assignments: {} }
 */
export function parseExpoWebScript(script: unknown): ExpoWebScriptReading {
  if (script === undefined)
    return { readiness: { form: 'absent' }, assignments: {} }
  if (typeof script !== 'string')
    return {
      readiness: {
        form: 'refused',
        refused: ['a web script that is not text'],
      },
      assignments: {},
    }
  const words = script.trim().split(/\s+/)
  const { assignments, refused, index } = readLeadingAssignments(
    words,
    EXPO_CODEBOOK_OWNED_NAMES,
  )
  const [command, subcommand, ...flags] = words.slice(index)
  const foreign = describeForeignCommand(command, 'expo')
  if (foreign) refused.push(...foreign)
  else if (subcommand !== 'start')
    refused.push('expo with a command other than start')
  else {
    const described = describeExpoFlags(flags)
    refused.push(...described.refused)
    if (refused.length === 0)
      return {
        readiness: { form: 'accepted' },
        assignments,
        ...(described.port === undefined ? {} : { port: described.port }),
      }
  }
  return {
    readiness: { form: 'refused', refused: [...new Set(refused)] },
    assignments: {},
  }
}
