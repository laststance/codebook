import { declarationStatementEndLine } from './declarationStatementEndLine'
import { declaredInspectionBindings } from './declaredInspectionBindings'

/** A declaration the hint found: its line and the binding it declares. */
interface FoundDeclaration {
  declaringLine: number
  binding: string
}

/**
 * Tells the editor agent why a required inspection had no value when the stopped line, a later line of the stop's citation, or the statement the stop paused inside declares that binding, called by {@link ConfiguredBrowserRun} when it words that failure.
 * The debugger pauses before the line runs, so a `const` or `let` it declares is not initialized yet; the agent cannot see that from "unavailable". Codebook requests a stop whose own declared line declares a required binding on the first line after the declaring statement that can pause, so the hint is left for a stop with no such line in its citation, a statement whose end the scan cannot tell, a map too large to scan, a stop before the declaration, and a stop that paused inside the declaring statement: its advice names the line the stop must follow, so that an agent does not move the stop onto an earlier line that declares the binding again.
 * @param source - The sealed original source of the stop.
 * @param line - The 1-based line the debugger paused on.
 * @param inspectionPath - The inspection's path; its first segment is the binding.
 * @param citationEndLine - The last line of the stop's citation; the lines from the declared or the paused one, whichever is first, up to it are read for the declaration. Without it only the paused line is read.
 * @param declaredLine - The line the stop was declared on, when Codebook requested it elsewhere; without it the paused line.
 * @returns
 * - When the paused line declares the binding with `const` or `let`: one sentence naming that line, that the stop must come after it, and the fix, beginning with a space
 * - When a later line up to `citationEndLine` declares it: one sentence naming the declaring line and the paused line, beginning with a space
 * - When the declared line declares it in a statement that had not ended on the paused line: one sentence naming the declaring line, the statement's last line and the paused line, beginning with a space
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
  declaredLine = line,
): string {
  const lines = source.split(/\r\n?|\n/)
  const declaration = firstDeclaringLine(
    lines,
    Math.min(declaredLine, line),
    citationEndLine,
    inspectionPath,
  )
  if (!declaration) return ''
  return hintSentence(lines, line, declaration, citationEndLine)
}

/**
 * Words the hint for a declaration found at, after or before the paused line; called by {@link selfDeclaredInspectionHint}.
 * @param lines - The sealed source's lines.
 * @param line - The 1-based line the debugger paused on.
 * @param declaration - The declaration found.
 * @param citationEndLine - The last line of the stop's citation.
 * @returns The sentence, or `''` for a declaration before the paused line whose statement had already ended there (the missing value has another cause).
 * @example
 * hintSentence(['const total = useMemo(() => {', '  return sum(items)', '}, [items])'], 2, { declaringLine: 1, binding: 'total' }, 3)
 * // => ' Line 1 declares total in a statement that ends on line 3, and the debugger paused on line 2 inside it, so total has no value yet there; …'
 */
function hintSentence(
  lines: readonly string[],
  line: number,
  declaration: FoundDeclaration,
  citationEndLine: number,
): string {
  if (declaration.declaringLine >= line)
    return beforeDeclarationSentence(line, declaration)
  const statementEnd = declarationStatementEndLine(
    lines,
    declaration.declaringLine,
    citationEndLine,
  )
  // A declaration before the paused line explains the missing value only while its statement had not ended there.
  return statementEnd !== undefined && statementEnd >= line
    ? insideStatementSentence(line, declaration, statementEnd)
    : ''
}

/**
 * Words the hint for a declaration on the paused line or after it; called by {@link hintSentence}.
 * @example
 * beforeDeclarationSentence(20, { declaringLine: 21, binding: 'state' }) // => ' Line 21 declares state, after line 20 where the debugger paused, …'
 */
function beforeDeclarationSentence(
  line: number,
  { declaringLine, binding }: FoundDeclaration,
): string {
  const advice = `a stop that requires ${binding} must be on a line after line ${declaringLine}, so declare it on a later line within a citation that covers that line, or require a value that already exists before line ${line}.`
  return declaringLine === line
    ? ` Line ${line} declares ${binding}, so it has no value yet when the debugger pauses before that line runs; ${advice}`
    : ` Line ${declaringLine} declares ${binding}, after line ${line} where the debugger paused, so it has no value yet there; ${advice}`
}

/**
 * Words the hint for a stop that paused inside the statement its declared line begins (a callback or an object literal of the declaration); called by {@link hintSentence}.
 * @example
 * insideStatementSentence(22, { declaringLine: 21, binding: 'total' }, 23)
 * // => ' Line 21 declares total in a statement that ends on line 23, and the debugger paused on line 22 inside it, so total has no value yet there; a stop that requires total must be on a line after line 23, so declare it on a later line within a citation that covers that line, or require a value that already exists before line 21.'
 */
function insideStatementSentence(
  line: number,
  { declaringLine, binding }: FoundDeclaration,
  statementEnd: number,
): string {
  return ` Line ${declaringLine} declares ${binding} in a statement that ends on line ${statementEnd}, and the debugger paused on line ${line} inside it, so ${binding} has no value yet there; a stop that requires ${binding} must be on a line after line ${statementEnd}, so declare it on a later line within a citation that covers that line, or require a value that already exists before line ${declaringLine}.`
}

/**
 * Finds the first line, from the declared or the paused one to the end of the stop's citation, that declares an inspection's binding; called by {@link selfDeclaredInspectionHint}.
 * @param lines - The sealed source's lines.
 * @param fromLine - The 1-based line to begin at: the declared or the paused line, whichever is first.
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
): FoundDeclaration | undefined {
  // The first line from there on that declares the binding is the one the hint names.
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
