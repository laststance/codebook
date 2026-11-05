import {
  REACT_SCRIPTS_ENV_EXPANSION_MAX_DEPTH,
  REACT_SCRIPTS_ENV_VALUE_MAX_CHARS,
} from '../constants'

/** How much substitution work is left while the `.env` files of one app settle; shared by every value so a chain of doubling references ends. */
export type DotenvExpansionBudget = { remainingSteps: number }

/**
 * Replaces the `$NAME` and `${NAME}` references of one value exactly as dotenv-expand 5.1.0 does, recursively, over the given environment.
 *
 * Why it exists: react-scripts inlines the value dotenv-expand settles, so the mask list must hold that value, not the text of the file. Called by {@link expandDotenvFile}.
 * Divergence from dotenv-expand, on purpose: recursion stops at {@link REACT_SCRIPTS_ENV_EXPANSION_MAX_DEPTH}, the substitution count at the budget and the value length at {@link REACT_SCRIPTS_ENV_VALUE_MAX_CHARS}; past a bound the text stays as it is (react-scripts itself overflows its stack on a cycle).
 * @param value - The text that may hold references.
 * @param environment - What a reference resolves from; an unknown name is empty.
 * @param budget - The shared substitution budget.
 * @param depth - The current recursion depth.
 * @returns The expanded text.
 * @example interpolateDotenvValue('${A}/x', new Map([['A', 'a']]), { remainingSteps: 10 }, 0) // => 'a/x'
 */
function interpolateDotenvValue(
  value: string,
  environment: ReadonlyMap<string, string>,
  budget: DotenvExpansionBudget,
  depth: number,
): string {
  if (
    depth > REACT_SCRIPTS_ENV_EXPANSION_MAX_DEPTH ||
    value.length > REACT_SCRIPTS_ENV_VALUE_MAX_CHARS
  )
    return value
  const matches = value.match(/(.?\${?(?:[a-zA-Z0-9_]+)?}?)/g) ?? []
  let expanded = value
  for (const match of matches) {
    if (budget.remainingSteps <= 0) break
    budget.remainingSteps -= 1
    const parts = /(.?)\${?([a-zA-Z0-9_]+)?}?/g.exec(match)
    if (!parts) continue
    const prefix = parts[1] ?? ''
    if (prefix === '\\') {
      // An escaped dollar stays literal; dotenv-expand drops the backslash and keeps the rest.
      expanded = expanded.replace(parts[0], parts[0].replace('\\$', '$'))
      continue
    }
    const replacePart = parts[0].substring(prefix.length)
    const referenced = environment.get(parts[2] ?? '') ?? ''
    // Same string-replacement semantics as dotenv-expand, so the settled text is the text react-scripts inlines.
    expanded = expanded.replace(
      replacePart,
      interpolateDotenvValue(referenced, environment, budget, depth + 1),
    )
  }
  return expanded
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
 * expandDotenvFile(new Map([['A', '$BASE']]), environment, { remainingSteps: 10 }) // environment.get('A') => 'b'
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
  for (const [name, value] of parsed)
    expanded.set(
      name,
      interpolateDotenvValue(
        environment.get(name) ?? value,
        environment,
        budget,
        0,
      ),
    )
  // The expanded value is written back for every parsed name, set before or not.
  for (const [name, value] of expanded) environment.set(name, value)
}
