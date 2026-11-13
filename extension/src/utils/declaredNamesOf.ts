import {
  DECLARATION_MODIFIERS,
  isCallbackLine,
  methodHeadPattern,
} from './declarationHead'

/** A `function` or `class` declaration: the name follows the keyword (`function* run`, `class Store`; `class extends X` has none). */
const FUNCTION_OR_CLASS_DECLARATION = new RegExp(
  `^${DECLARATION_MODIFIERS}(?:function\\s*\\*?\\s*|class\\s+(?!extends\\b))([\\w$]+)`,
)
/** A `const`, `let` or `var` whose value starts a function on the same line: `function`, an arrow with parentheses (a generic `<T,>` may come first) or a single-parameter arrow. An optional `: type` holding no `=` may precede the `=`. */
const FUNCTION_VALUE_DECLARATION = new RegExp(
  `^${DECLARATION_MODIFIERS}(?:const|let|var)\\s+([\\w$]+)\\s*(?::[^=]*)?=\\s*(?:async\\s+)?(?:function\\b|(?:<[^>]*>\\s*)?\\(.*=>|[\\w$]+\\s*=>)`,
)
/** Words that open a statement with a parenthesis and a brace (`if (ready) {`) or a function expression (`function () {`), none of them a method name. */
const NON_METHOD_NAMES = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'with',
  'return',
  'function',
])

/**
 * Reads the name one source line declares as a function, class or method, or undefined when it declares none.
 * Called by {@link declaredNamesOf} for each line that is not a comment.
 * @param text - One trimmed source line.
 * @returns The declared name, or undefined for a value declaration, a call, a statement or a line that only starts a declaration.
 * @example
 * declaredNameOfLine('static async refresh(id) {') // => 'refresh'
 * declaredNameOfLine('const state = {') // => undefined
 */
function declaredNameOfLine(text: string): string | undefined {
  const keywordName =
    FUNCTION_OR_CLASS_DECLARATION.exec(text)?.[1] ??
    FUNCTION_VALUE_DECLARATION.exec(text)?.[1]
  if (keywordName) return keywordName
  // A method opens its body on its own line, with an optional accessor word before the name.
  const methodName = methodHeadPattern(
    '([\\w$]+)',
    '',
    '(?:(?:get|set)\\s+)?',
  ).exec(text)?.[1]
  if (!methodName || NON_METHOD_NAMES.has(methodName) || isCallbackLine(text))
    return undefined
  return methodName
}

/**
 * Lists the functions, classes and methods a source declares, so a Wiki question's route request can offer the model names no Wiki page mentions.
 * Why: the editor model has no tools and sees only the route request, so a function no page names (Cycle 0124: `pasteItem`) could never be routed to (Cycle 0125 F3b, Issue #320).
 * Called by {@link declaredNamesLineOf} for each long source the route request offers.
 * The rule is line-based: a declaration counts only when one physical line shows both its name and that it is a function, class or method. Only the first declarator of a line is read, and comment lines are skipped.
 * @param lines - The source's lines.
 * @returns The declared names in source order, each once, with their case kept.
 * @example
 * declaredNamesOf(['export async function pasteItem(paneNum) {', 'const state = {', '  static refresh(id) {']) // => ['pasteItem', 'refresh']
 */
export function declaredNamesOf(lines: readonly string[]): string[] {
  const names = new Set<string>()
  for (const line of lines) {
    const text = line.trim()
    // Comment lines may quote declarations; they declare nothing.
    if (/^(?:\/\/|\/\*|\*)/.test(text)) continue
    const name = declaredNameOfLine(text)
    if (name) names.add(name)
  }
  return [...names]
}
