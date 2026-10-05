import { declaredInspectionBindings } from './declaredInspectionBindings'

/**
 * Tells the editor agent why a required inspection had no value when the stopped line, or a later line of the stop's citation, declares that binding, called by {@link ConfiguredBrowserRun} when it words that failure.
 * The debugger pauses before the line runs, so a `const` or `let` it declares is not initialized yet; the agent cannot see that from "unavailable". Codebook requests a stop whose own declared line declares a required binding on the first line after it that can pause, so the hint is left for a stop with no such line in its citation, a map too large to scan, and a stop before the declaration: its advice names the declaring line, so that an agent does not move the stop onto an earlier line that declares the binding again.
 * @param source - The sealed original source of the stop.
 * @param line - The 1-based line the debugger paused on.
 * @param inspectionPath - The inspection's path; its first segment is the binding.
 * @param citationEndLine - The last line of the stop's citation; the lines from the paused one up to it are read for the declaration. Without it only the paused line is read.
 * @returns
 * - When the paused line declares the binding with `const` or `let`: one sentence naming that line, that the stop must come after it, and the fix, beginning with a space
 * - When a later line up to `citationEndLine` declares it: one sentence naming the declaring line and the paused line, beginning with a space
 * - Otherwise: `''`
 * @example
 * selfDeclaredInspectionHint('const user = await getUser(email)', 1, 'user')
 * // => ' Line 1 declares user, so it has no value yet when the debugger pauses before that line runs; a stop that requires user must be on a line after line 1, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 1.'
 * selfDeclaredInspectionHint('return user', 1, 'user') // => ''
 */
export function selfDeclaredInspectionHint(
  source: string,
  line: number,
  inspectionPath: string,
  citationEndLine = line,
): string {
  const declaration = firstDeclaringLine(
    source.split(/\r\n?|\n/),
    line,
    citationEndLine,
    inspectionPath,
  )
  if (!declaration) return ''
  const { declaringLine, binding } = declaration,
    advice = `a stop that requires ${binding} must be on a line after line ${declaringLine}, so declare it on a later line within a citation that covers that line, or require a value that already exists before line ${line}.`
  return declaringLine === line
    ? ` Line ${line} declares ${binding}, so it has no value yet when the debugger pauses before that line runs; ${advice}`
    : ` Line ${declaringLine} declares ${binding}, after line ${line} where the debugger paused, so it has no value yet there; ${advice}`
}

/**
 * Finds the first line, from the paused one to the end of the stop's citation, that declares an inspection's binding; called by {@link selfDeclaredInspectionHint}.
 * @param lines - The sealed source's lines.
 * @param fromLine - The 1-based line the debugger paused on.
 * @param toLine - The last line of the stop's citation (never past the source's last line).
 * @param inspectionPath - The inspection's path; its first segment is the binding.
 * @returns The declaring line and the binding, or `undefined` when no line in that range declares it.
 * @example
 * firstDeclaringLine(['const callbackUrl = read()', 'const [state] = use()'], 1, 2, 'state') // => { declaringLine: 2, binding: 'state' }
 */
function firstDeclaringLine(
  lines: readonly string[],
  fromLine: number,
  toLine: number,
  inspectionPath: string,
): { declaringLine: number; binding: string } | undefined {
  // The first line from the paused one on that declares the binding is the one the stop must come after.
  for (
    let declaringLine = fromLine;
    declaringLine <= Math.min(toLine, lines.length);
    declaringLine++
  ) {
    const [binding] = declaredInspectionBindings(
      lines[declaringLine - 1] ?? '',
      [inspectionPath],
    )
    if (binding) return { declaringLine, binding }
  }
  return undefined
}
