import {
  REACT_SCRIPTS_ENV_EXPANSION_MAX_DEPTH,
  REACT_SCRIPTS_ENV_VALUE_MAX_CHARS,
} from '../constants'

/** How much substitution work is left while the `.env` files of one app settle; shared by every value so a chain of doubling references ends. `exceeded` turns true at the first bound reached, after which the settled values are unknown. */
export type DotenvExpansionBudget = {
  remainingSteps: number
  remainingCopiedChars: number
  exceeded: boolean
}

/**
 * Replaces the `$NAME` and `${NAME}` references of one value exactly as dotenv-expand 5.1.0 does, recursively, over the given environment.
 *
 * Why it exists: react-scripts inlines the value dotenv-expand settles, so the mask list must hold that value, not the text of the file. Called by {@link expandDotenvFile}.
 * Divergence from dotenv-expand, on purpose: recursion stops at {@link REACT_SCRIPTS_ENV_EXPANSION_MAX_DEPTH}, the substitution count and the copied characters at the budget, and a value's length at {@link REACT_SCRIPTS_ENV_VALUE_MAX_CHARS}. Reaching any bound sets `budget.exceeded` and stops, because the value react-scripts inlines is then unknown; the caller refuses the start (react-scripts itself overflows its stack on a cycle).
 * @param value - The text that may hold references.
 * @param environment - What a reference resolves from; an unknown name is empty.
 * @param budget - The shared substitution budget.
 * @param depth - The current recursion depth.
 * @returns The expanded text.
 * @example interpolateDotenvValue('${A}/x', new Map([['A', 'a']]), { remainingSteps: 10, remainingCopiedChars: 100, exceeded: false }, 0) // => 'a/x'
 */
function interpolateDotenvValue(
  value: string,
  environment: ReadonlyMap<string, string>,
  budget: DotenvExpansionBudget,
  depth: number,
): string {
  // A bound reached anywhere leaves every settled value unknown; stop at once.
  if (budget.exceeded) return value
  if (
    depth > REACT_SCRIPTS_ENV_EXPANSION_MAX_DEPTH ||
    value.length > REACT_SCRIPTS_ENV_VALUE_MAX_CHARS
  )
    return markBoundReached(budget, value)
  let expanded = value
  for (const match of value.match(/(.?\${?(?:[a-zA-Z0-9_]+)?}?)/g) ?? []) {
    expanded = substituteReference(expanded, match, environment, budget, depth)
    if (budget.exceeded) return expanded
  }
  return expanded
}

/**
 * Records that a bound was reached and hands the text back unchanged. @example markBoundReached(budget, '$A') // => '$A', budget.exceeded === true
 */
function markBoundReached(budget: DotenvExpansionBudget, text: string): string {
  budget.exceeded = true
  return text
}

/**
 * Applies one reference match of dotenv-expand 5.1.0 to the value being built: an escaped dollar becomes literal, a name is replaced by its recursively expanded value. Called by {@link interpolateDotenvValue} once per match.
 * @param expanded - The value as built so far.
 * @param match - One match of dotenv-expand's reference pattern.
 * @param environment - What a reference resolves from; an unknown name is empty.
 * @param budget - The shared substitution budget; charged one step and the rebuilt length.
 * @param depth - The recursion depth of the value being built.
 * @returns The value after this match; past a bound, `budget.exceeded` is set and the value is no longer settled.
 * @example substituteReference('$A/x', '$A', new Map([['A', 'a']]), budget, 0) // => 'a/x'
 */
function substituteReference(
  expanded: string,
  match: string,
  environment: ReadonlyMap<string, string>,
  budget: DotenvExpansionBudget,
  depth: number,
): string {
  if (budget.remainingSteps <= 0) return markBoundReached(budget, expanded)
  budget.remainingSteps -= 1
  const parts = /(.?)\${?([a-zA-Z0-9_]+)?}?/g.exec(match)
  if (!parts) return expanded
  const prefix = parts[1] ?? ''
  // An escaped dollar stays literal; dotenv-expand drops the backslash and keeps the rest.
  if (prefix === '\\')
    return chargeRebuilt(
      budget,
      expanded.replace(parts[0], parts[0].replace('\\$', '$')),
    )
  const replacement = interpolateDotenvValue(
    environment.get(parts[2] ?? '') ?? '',
    environment,
    budget,
    depth + 1,
  )
  if (budget.exceeded) return expanded
  // Same string-replacement semantics as dotenv-expand, so the settled text is the text react-scripts inlines.
  return chargeRebuilt(
    budget,
    expanded.replace(parts[0].substring(prefix.length), replacement),
  )
}

/**
 * Charges a rebuilt value's length to the budget, since every replacement copies the whole value, and marks the bound when the value or the copied total grows past it. Called by {@link substituteReference} after each replacement, escapes included.
 * @param budget - The shared substitution budget.
 * @param rebuilt - The value after one replacement.
 * @returns The rebuilt value; past a bound, `budget.exceeded` is set and the value is no longer settled.
 * @example chargeRebuilt({ remainingSteps: 9, remainingCopiedChars: 100, exceeded: false }, 'a/x') // => 'a/x' (97 characters left)
 */
function chargeRebuilt(budget: DotenvExpansionBudget, rebuilt: string): string {
  budget.remainingCopiedChars -= rebuilt.length
  if (
    rebuilt.length > REACT_SCRIPTS_ENV_VALUE_MAX_CHARS ||
    budget.remainingCopiedChars < 0
  )
    return markBoundReached(budget, rebuilt)
  return rebuilt
}

/**
 * Loads one parsed `.env` file into the environment as dotenv 10 and dotenv-expand 5.1.0 do: names already set stay, the rest are added, then every parsed value is expanded against the environment and written back.
 *
 * Why it exists: react-scripts loads its `.env` files one after the other this way, so a later file's reference sees the values of the earlier ones. Called by {@link readReactScriptsAppSettings} once per existing file, in react-scripts' order.
 * @param parsed - The names and values the file sets.
 * @param environment - The environment so far; changed in place.
 * @param budget - The shared substitution budget.
 * @example
 * const environment = new Map([['BASE', 'b']])
 * expandDotenvFile(new Map([['A', '$BASE']]), environment, { remainingSteps: 10, remainingCopiedChars: 100, exceeded: false }) // environment.get('A') => 'b'
 */
export function expandDotenvFile(
  parsed: ReadonlyMap<string, string>,
  environment: Map<string, string>,
  budget: DotenvExpansionBudget,
): void {
  // dotenv never overrides a name that is already set.
  for (const [name, value] of parsed)
    if (!environment.has(name)) environment.set(name, value)
  const expanded = new Map<string, string>()
  for (const [name, value] of parsed) {
    // Past a bound the caller refuses the start; the rest of the file is not worth expanding.
    if (budget.exceeded) return
    expanded.set(
      name,
      interpolateDotenvValue(
        environment.get(name) ?? value,
        environment,
        budget,
        0,
      ),
    )
  }
  // The expanded value is written back for every parsed name, set before or not.
  for (const [name, value] of expanded) environment.set(name, value)
}
