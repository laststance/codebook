/** Words that may stand before a declared name: `export default async function run`, `public static run() {`. */
const DECLARATION_MODIFIERS =
  '(?:(?:export|default|declare|async|public|private|protected|static|abstract|override|readonly)\\s+)*'

/**
 * Escapes a text for use inside a regular expression.
 * @param text - Any text.
 * @returns The text with every regular expression metacharacter escaped.
 * @example
 * escapeRegExp('a.b') // => 'a\\.b'
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Tells whether a source line declares a name: a `function`, `function*`, `class`, `const`, `let` or `var` declaration, or an object or class method that opens its body on the line.
 * @param line - One source line.
 * @param name - The declared name to look for, compared without regard to case.
 * @returns `true` for `export default async function pasteItem() {`, `class PasteItem {`, `const pasteItem = async () => {` and `  pasteItem(source) {`; `false` for a call such as `pasteItem(source)` or `await pasteItem(source)`, a callback opener such as `pasteItem(() => {` and a line that only contains the name.
 * @example
 * declaresName('async function pasteItem() {', 'pasteItem') // => true
 * declaresName('  await pasteItem()', 'pasteItem') // => false
 */
function declaresName(line: string, name: string): boolean {
  // Only an identifier can be a declared name; an empty part (`a.`) or a path never is.
  if (!/^[\w$]+$/.test(name)) return false
  const text = line.trim()
  const escaped = escapeRegExp(name)
  const keywordDeclaration = new RegExp(
    `^${DECLARATION_MODIFIERS}(?:function\\s*\\*?\\s*|class\\s+|(?:const|let|var)\\s+)${escaped}(?![\\w$])`,
    'i',
  )
  if (keywordDeclaration.test(text)) return true
  // A method opens its body on its own line; a callback or an arrow function after the name is a call.
  const method = new RegExp(
    `^${DECLARATION_MODIFIERS}${escaped}\\s*[<(].*\\{$`,
    'i',
  )
  return method.test(text) && !text.includes('=>')
}

/**
 * Tells whether a source line declares one of the identifiers a route reply named, so a Wiki question's excerpt can rank that declaration above every line that only mentions them.
 * Why: Cycle 0123 (F3, Issue #316) — the declaration of `pasteItem` ranked below call sites of other route identifiers, so single lines of those filled the excerpt before the function's head.
 * Called by {@link selectWikiSourceLines} to score each line of a long file, and by its anchor pass to find the anchors that declare a route identifier.
 * @param line - One source line.
 * @param priorityTerms - The identifiers the route reply named, lowercased; a dotted identifier is matched by its last part.
 * @returns `true` when the line declares the name of any identifier.
 * @example
 * declaresPriorityTerm('export async function pasteItem() {', ['clipboard', 'pasteitem']) // => true
 * declaresPriorityTerm('await pasteItem()', ['pasteitem']) // => false
 */
export function declaresPriorityTerm(
  line: string,
  priorityTerms: readonly string[],
): boolean {
  return priorityTerms.some((term) =>
    declaresName(line, term.slice(term.lastIndexOf('.') + 1)),
  )
}
