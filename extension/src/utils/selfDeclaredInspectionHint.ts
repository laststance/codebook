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
    const headStart = keyword.lastIndex
    let headEnd = headStart
    // The head cannot hold `=` or `;`, so the first one after the keyword ends it.
    while (
      headEnd < lineText.length &&
      lineText[headEnd] !== '=' &&
      lineText[headEnd] !== ';'
    )
      headEnd++
    // Nothing ends a head on the rest of the line, so no later keyword has an initializer either.
    if (headEnd === lineText.length) return undefined
    if (
      lineText[headEnd] === '=' &&
      lineText[headEnd + 1] !== '=' &&
      headEnd > headStart
    )
      return lineText.slice(headStart, headEnd).trim()
    // A keyword before this `;` or comparison would end at it too: go on after it.
    keyword.lastIndex = headEnd + 1
  }
  return undefined
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
  // The head of the declaration ends at its initializer; a `var` is hoisted and readable as undefined, so it is no case.
  const head = declarationHead(lineText)
  if (!head || !declaredNames(head).includes(binding)) return ''
  return ` Line ${line} declares ${binding}, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.`
}
