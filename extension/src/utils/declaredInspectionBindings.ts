/** How much one character changes the depth of a destructuring pattern: an opening bracket goes one deeper, a closing one back out. */
const PATTERN_DEPTH_STEP: Readonly<Record<string, number>> = {
  '{': 1,
  '[': 1,
  '}': -1,
  ']': -1,
}

/**
 * Cuts a type annotation off a destructuring head, so `{ user }: Session` binds `user` and not `Session`; called by {@link declaredNames} for a head that begins with a pattern.
 * @param head - A trimmed declaration head that begins with `{` or `[`.
 * @returns The head up to the bracket that closes its first pattern, or the head itself when that bracket never closes (a default value ended the head inside the pattern).
 * @example
 * withoutTypeAnnotation('{ user }: Session') // => '{ user }'
 * withoutTypeAnnotation('{ a: { b } }: Props') // => '{ a: { b } }'
 */
function withoutTypeAnnotation(head: string): string {
  let depth = 0
  // The pattern ends at the first character that brings the depth back to zero.
  const closingIndex = head.split('').findIndex((character) => {
    depth += PATTERN_DEPTH_STEP[character] ?? 0
    return depth === 0
  })
  return closingIndex === -1 ? head : head.slice(0, closingIndex + 1)
}

/** Lists the names one declaration head binds: a plain name, or the targets of an object or array pattern. @example declaredNames('{ user, id: userId }') // ['user', 'userId'] */
function declaredNames(head: string): string[] {
  const trimmed = head.trim()
  const isPattern = /^[{[]/.test(trimmed)
  return (isPattern ? withoutTypeAnnotation(trimmed) : trimmed)
    .split(/[{}[\],]/)
    .map((piece) => {
      const element = piece.trim().replace(/^\.\.\./, '')
      // In a pattern `key: name` binds the name; a plain declaration's `name: Type` binds the part before the colon.
      const [first = '', second] = element.split(':').map((part) => part.trim())
      return isPattern && second !== undefined ? second : first
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
 * Finds the head of the first `const` or `let` declaration with an initializer on a line (the text between the keyword and its `=`), for {@link declaredInspectionBindings}.
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
 * Names the bindings among a stop's inspections that one line of source declares, because the debugger pauses before a line runs and a `const` or `let` that line declares has no value yet there.
 * {@link ConfiguredBrowserRun} asks it at preparation for a stop's declared line and its required inspections, to request that stop on the first line after it that can pause; {@link selfDeclaredInspectionHint} asks it for the line a required value was unavailable on and the lines after it.
 * @param lineText - One line of source, without its line ending.
 * @param inspectionPaths - The inspections' paths; the first segment of each is the binding it reads.
 * @returns
 * - The bindings the first `const` or `let` declaration with an initializer on the line binds, each once, in the order of the paths
 * - `[]` when the line declares none of them, also for a `var` (hoisted and readable as undefined) and for a line that only reads a name
 * @example
 * declaredInspectionBindings('const { user, id: userId } = await load()', ['userId', 'user.email']) // => ['userId', 'user']
 * declaredInspectionBindings('return user', ['user'])                                            // => []
 */
export function declaredInspectionBindings(
  lineText: string,
  inspectionPaths: readonly string[],
): string[] {
  // The head of the declaration ends at its initializer; a `var` is hoisted and readable as undefined, so it is no case.
  const head = declarationHead(lineText)
  if (!head) return []
  const names = declaredNames(head)
  const bindings = inspectionPaths.map((path) => path.split('.')[0] ?? '')
  return [...new Set(bindings)].filter((binding) => names.includes(binding))
}
