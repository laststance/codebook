/** Lists the names one declaration head binds: a plain name, or the targets of an object or array pattern. @example declaredNames('{ user, id: userId }') // ['user', 'userId'] */
function declaredNames(head: string): string[] {
  return head
    .split(/[{}[\],]/)
    .map((piece) => {
      const element = piece.trim().replace(/^\.\.\./, '')
      // In a pattern `key: name` binds the name; a plain declaration's `name: Type` binds the part before the colon.
      const [first = '', second] = element.split(':').map((part) => part.trim())
      return /^[{[]/.test(head.trim()) && second !== undefined ? second : first
    })
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name))
}

/**
 * Finds where a declaration head that begins at a position ends; called by {@link declarationHead} for each keyword, in one pass from left to right.
 * @param lineText - One line of source.
 * @param headStart - The position right after the keyword and its one white space character.
 * @returns The position of the first `=` or `;` from there on (a head cannot hold either), or the line's length when nothing ends the head.
 * @example
 * headEndFrom('const user = load()', 6) // => 11
 */
function headEndFrom(lineText: string, headStart: number): number {
  let headEnd = headStart
  // The head cannot hold `=` or `;`, so the first one after the keyword ends it.
  while (
    headEnd < lineText.length &&
    lineText[headEnd] !== '=' &&
    lineText[headEnd] !== ';'
  )
    headEnd++
  return headEnd
}

/**
 * Says whether a declaration head ends at an initializer; called by {@link declarationHead} for the character that ends a head.
 * @param lineText - One line of source.
 * @param headStart - Where the head begins.
 * @param headEnd - Where it ends: the position of an `=` or a `;`.
 * @returns `true` for a single `=` after a head that is not empty; `false` for a `;`, a comparison (`==`, `===`) and an empty head.
 * @example
 * isInitializerAt('const user = load()', 6, 11) // => true
 * isInitializerAt('let a; a = 1', 4, 5)         // => false
 */
function isInitializerAt(
  lineText: string,
  headStart: number,
  headEnd: number,
): boolean {
  return (
    lineText[headEnd] === '=' &&
    lineText[headEnd + 1] !== '=' &&
    headEnd > headStart
  )
}

/**
 * Finds the head of the first `const` or `let` declaration with an initializer on a line (the text between the keyword and its `=`), for {@link selfDeclaredInspectionHint}.
 * The line is repository source of any length, read on the extension host, so it is scanned once from left to right: each keyword's head ends at the first `=` or `;` after it, and the scan goes on after that character. A pattern that searches from every keyword to the end of the line, or lets two whitespace runs share one span, takes quadratic or cubic time on a long line.
 * @param lineText - One line of source.
 * @returns
 * - The trimmed head of the first declaration whose head ends at a single `=`
 * - `undefined` when no `const` or `let` on the line is followed by an initializer (a `;` or a comparison ends a head without one)
 * @example
 * declarationHead('const { user, id: userId } = await load()') // => '{ user, id: userId }'
 * declarationHead('if (a === b) return')                      // => undefined
 */
function declarationHead(lineText: string): string | undefined {
  // The keyword stands at a word boundary and is followed by white space; the head begins after that one character.
  const keyword = /\b(?:const|let)\s/g
  while (keyword.exec(lineText)) {
    const headStart = keyword.lastIndex,
      headEnd = headEndFrom(lineText, headStart)
    // Nothing ends a head on the rest of the line, so no later keyword has an initializer either.
    if (headEnd === lineText.length) return undefined
    if (isInitializerAt(lineText, headStart, headEnd))
      return lineText.slice(headStart, headEnd).trim()
    // A keyword before this `;` or comparison would end at it too: go on after it.
    keyword.lastIndex = headEnd + 1
  }
  return undefined
}

/**
 * Says whether a line declares a binding with an initializer; called by {@link selfDeclaredInspectionHint} for the stopped line and the inspection's binding.
 * @param lineText - One line of source.
 * @param binding - The name the inspection reads first.
 * @returns `true` when the first `const` or `let` declaration with an initializer on the line binds that name; `false` otherwise, also for a `var`, which is hoisted and readable as undefined.
 * @example
 * declaresBinding('const { user, id: userId } = await load()', 'userId') // => true
 * declaresBinding('return user', 'user')                                 // => false
 */
function declaresBinding(lineText: string, binding: string): boolean {
  // The head of the declaration ends at its initializer; a `var` is hoisted and readable as undefined, so it is no case.
  const head = declarationHead(lineText)
  return head ? declaredNames(head).includes(binding) : false
}

/**
 * Tells the editor agent why a required inspection had no value when the stopped line itself declares that binding, called by {@link ConfiguredBrowserRun} when it words that failure.
 * The debugger pauses before the line runs, so a `const` or `let` it declares is not initialized yet; the agent cannot see that from "unavailable".
 * @param source - The sealed original source of the stop.
 * @param line - The 1-based line the debugger paused on.
 * @param inspectionPath - The inspection's path; its first segment is the binding.
 * @returns
 * - When that line declares the binding with `const` or `let`: one sentence naming the line and the fix, beginning with a space
 * - Otherwise: `''`
 * @example
 * selfDeclaredInspectionHint('const user = await getUser(email)', 1, 'user')
 * // => ' Line 1 declares user, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.'
 * selfDeclaredInspectionHint('return user', 1, 'user') // => ''
 */
export function selfDeclaredInspectionHint(
  source: string,
  line: number,
  inspectionPath: string,
): string {
  const lineText = source.split(/\r\n?|\n/)[line - 1] ?? '',
    binding = inspectionPath.split('.')[0] ?? ''
  if (!declaresBinding(lineText, binding)) return ''
  return ` Line ${line} declares ${binding}, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.`
}
