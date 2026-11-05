import { hasShellSyntax } from './parseViteDevScript'
import { sanitizeDeclaredPath } from './resolveNextPackage'

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

/**
 * Reads the `start` script of a react-scripts app: accepted only as exactly `react-scripts start`, optionally preceded by `NAME=value` assignments.
 *
 * Why it exists: Codebook runs the app's installed `start.js` directly, so any other form (`cross-env`, extra arguments, a wrapper) would be silently skipped; it is listed as refused instead. Called by {@link readReactScriptsPackageReadiness}.
 *
 * @param script - The manifest's `scripts.start` value, `undefined` when there is none.
 * @returns
 * - `absent` readiness for no script
 * - `accepted` readiness with the assignments for the accepted form
 * - `refused` readiness naming the script (sanitized and bounded) for any other form, also a non-string value or an assignment value with shell syntax
 * @example
 * parseReactScriptsStartScript('PORT=4000 react-scripts start') // => { readiness: { form: 'accepted' }, assignments: { PORT: '4000' } }
 * parseReactScriptsStartScript('cross-env X=1 react-scripts start') // => { readiness: { form: 'refused', refused: ['cross-env X=1 react-scripts start'] }, assignments: {} }
 */
export function parseReactScriptsStartScript(
  script: unknown,
): ReactScriptsStartScriptReading {
  if (script === undefined)
    return { readiness: { form: 'absent' }, assignments: {} }
  const refusedReading: ReactScriptsStartScriptReading = {
    readiness: {
      form: 'refused',
      refused: [sanitizeDeclaredPath(String(script))],
    },
    assignments: {},
  }
  if (typeof script !== 'string') return refusedReading
  const words = script.trim().split(/\s+/)
  const assignments: Record<string, string> = {}
  let index = 0
  // Leading NAME=value words are environment assignments; a value with shell syntax refuses the whole script.
  for (; index < words.length; index += 1) {
    const match = ASSIGNMENT_WORD.exec(words[index]!)
    if (!match) break
    const [, name, value] = match
    if (hasShellSyntax(value!) || value!.startsWith('~')) return refusedReading
    assignments[name!] = value!
  }
  const isExactCommand =
    words.length === index + 2 &&
    words[index] === 'react-scripts' &&
    words[index + 1] === 'start'
  return isExactCommand
    ? { readiness: { form: 'accepted' }, assignments }
    : refusedReading
}
