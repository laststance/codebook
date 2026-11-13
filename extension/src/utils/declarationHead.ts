/** Words that may stand before a declared name: `export default async function run`, `public static run() {`. Cycle 0123 (Issue #316); shared with {@link declaredNamesOf} in Cycle 0125 (Issue #320). */
export const DECLARATION_MODIFIERS =
  '(?:(?:export|default|declare|async|public|private|protected|static|abstract|override|readonly)\\s+)*'
/** A `function` expression passed as an argument, right after `(` or `,` (`pasteItem(function () {`, `run(options, async function () {`): such a line is a call, not a method. A `function` inside a string (`kind = 'function'`) is not one. Cycle 0124 (Issue #318, PR #317's hosted review and the review round). */
const FUNCTION_EXPRESSION_ARGUMENT = /[(,]\s*(?:async\s+)?function\b/

/**
 * Builds the pattern of a method head: the modifiers, a name, then `(` or `<`, and a line that ends in `{`.
 * Why: {@link declaresPriorityTerm} (one known name) and {@link declaredNamesOf} (any name) must accept the same method heads, so the rule lives once.
 * Called by both when they test one trimmed source line; the caller still applies {@link isCallbackLine}.
 * @param namePattern - A regular expression source for the name; it may hold one capture group.
 * @param flags - Regular expression flags.
 * @param beforeName - A regular expression source accepted between the modifiers and the name.
 * @returns The pattern, anchored at the line's start.
 * @example
 * methodHeadPattern('pasteItem', 'i').test('static pasteItem(source) {') // => true
 */
export function methodHeadPattern(
  namePattern: string,
  flags: string,
  beforeName = '',
): RegExp {
  return new RegExp(
    `^${DECLARATION_MODIFIERS}${beforeName}${namePattern}\\s*[<(].*\\{$`,
    flags,
  )
}

/**
 * Tells whether a line holds a callback (`=>`, or a `function` expression as an argument), which makes a method-shaped line a call.
 * Called by {@link declaresPriorityTerm} and {@link declaredNamesOf} after {@link methodHeadPattern} matched.
 * @param text - One trimmed source line.
 * @returns `true` for `pasteItem(() => {` and `pasteItem(function () {`; `false` for `pasteItem(source) {`.
 * @example
 * isCallbackLine('pasteItem(() => {') // => true
 */
export function isCallbackLine(text: string): boolean {
  return text.includes('=>') || FUNCTION_EXPRESSION_ARGUMENT.test(text)
}
