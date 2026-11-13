import { DECLARATION_MODIFIERS } from './declarationHead'

/** A `function` or `class` declaration: the name follows the keyword, after whitespace or a generator `*` (`function run`, `function* run`, `function*run`, `class Store`; `class extends X` has none). `functionName(a) {` is no declaration of this kind: it is a method head. */
const FUNCTION_OR_CLASS_DECLARATION = new RegExp(
  `^${DECLARATION_MODIFIERS}(?:function(?:\\s*\\*\\s*|\\s+)|class\\s+(?!extends\\b))([\\w$]+)`,
)
/** A parameter list of a function value: parentheses with one level of nested parentheses (`(cb: (v: string) => void)`). */
const PARAMETER_LIST = '\\((?:[^()]|\\([^()]*\\))*\\)'
/** A `const`, `let` or `var` whose value is a function: `function`, an arrow whose own parameter list (a generic `<T,>` may come first, a `: type` may follow) is followed by `=>`, or a single-parameter arrow. The `=>` must follow the value's own parameters, so `const result = (items.map(item => item))` is a value, not a function. An optional `: type` holding no `=` may precede the `=`. */
const FUNCTION_VALUE_DECLARATION = new RegExp(
  `^${DECLARATION_MODIFIERS}(?:const|let|var)\\s+([\\w$]+)\\s*(?::[^=]*)?=\\s*(?:async\\s+)?(?:function\\b|(?:<[^>]*>\\s*)?${PARAMETER_LIST}\\s*(?::[^=]*?)?\\s*=>|[\\w$]+\\s*=>)`,
)
/** The start of a method head: modifiers, an optional accessor word, a name and the opening parenthesis of its parameters (a generic `<T>` may come between). */
const METHOD_HEAD = new RegExp(
  `^${DECLARATION_MODIFIERS}(?:(?:get|set)\\s+)?([\\w$]+)\\s*(?:<[^(]*>\\s*)?\\(`,
)
/** What may follow a method head's closing parenthesis: an optional return type annotation holding no `{`, then the `{` that ends the line. */
const METHOD_BODY_OPENER = /^\s*(?::[^{]*)?\{$/
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
 * Called by {@link declaredNamesOf} for each line that is not a comment. A `function` keyword counts only before whitespace or a generator `*`; a function value counts only when `=>` follows its own parameter list.
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
  return methodNameOf(text)
}

/**
 * Reads the name of a method head: `name(parameters) {`, with an optional accessor word, modifiers and return type annotation, or undefined for a call.
 * Why: the shared {@link isCallbackLine} drops any line holding `=>`, which loses `transform(fn: (v: string) => string) {` and keeps `setState({`; here the head counts only when its own closing parenthesis is followed by the body's `{`.
 * Called by {@link declaredNameOfLine} when no keyword declaration matched.
 * @param text - One trimmed source line.
 * @returns The method name, or undefined when the line is a call (`fetch(url, {`, `pasteItem(() => {`), a statement (`if (ready) {`) or ends before its body.
 * @example
 * methodNameOf('save(item: Item): Promise<void> {') // => 'save'
 * methodNameOf('run(callback = () => {}) {') // => 'run'
 * methodNameOf('dispatch({') // => undefined
 */
function methodNameOf(text: string): string | undefined {
  const head = METHOD_HEAD.exec(text)
  const name = head?.[1]
  if (!head || !name || NON_METHOD_NAMES.has(name)) return undefined
  // Walk to the parenthesis that closes the parameters; a callback's `{` or `(` inside stays inside.
  let depth = 1
  for (let index = head[0].length; index < text.length; index++) {
    const character = text[index]
    if (character === '(') depth++
    else if (character === ')') depth--
    if (depth > 0) continue
    // The parameters closed here; only an optional return type and the body's `{` may follow.
    return METHOD_BODY_OPENER.test(text.slice(index + 1)) ? name : undefined
  }
  // The parameters never close on this line: a call that opens a callback or an object.
  return undefined
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
