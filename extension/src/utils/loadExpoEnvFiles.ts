import {
  EXPO_WEB_ENV_FILES,
  REACT_SCRIPTS_ENV_EXPANSION_MAX_COPIED_CHARS,
  REACT_SCRIPTS_ENV_EXPANSION_MAX_DEPTH,
  REACT_SCRIPTS_ENV_EXPANSION_MAX_STEPS,
  REACT_SCRIPTS_ENV_VALUE_MAX_CHARS,
} from '../constants'

import type { DotenvExpansionBudget } from './expandDotenvFile'
import { parseExpoEnvText } from './parseExpoEnvText'
import {
  readReactScriptsEnvFile,
  type EnvFileReadPolicy,
} from './readReactScriptsEnvFile'

/**
 * dotenv-expand 11.0.7's reference pattern, as `@expo/env` 2.4.3 copies it: an optional escaping backslash, `$`, an optional brace, the name, an optional `:-` or `-` default (braces nested three levels) and an optional closing brace.
 * Kept as source text: each use builds its own global copy, because a global pattern is stateful.
 */
const EXPO_REFERENCE_SOURCE =
  /(\\)?(\$)(?!\()(\{?)([\w.]+)(?::?-((?:\$\{(?:\$\{(?:\$\{[^}]*\}|[^}])*}|[^}])*}|[^}])+))?(\}?)/
    .source

/** Records that a bound was reached and hands the text back unchanged. @example markBoundReached(budget, '$A') // => '$A', budget.exceeded === true */
function markBoundReached(budget: DotenvExpansionBudget, text: string): string {
  budget.exceeded = true
  return text
}

/**
 * Expands the references of one value exactly as `@expo/env` 2.4.3 does (dotenv-expand 11.0.7), recursively.
 *
 * Why it exists: Expo inlines the value this settles into the bundle Codebook archives, so the mask list must hold that value, not the file's text. Called by {@link expandExpoEnvironment}.
 * Order of a reference's sources, as in Expo: the process environment when it holds a non-empty value, then the files' own values unless the name is the value's own, then the `:-` default, else empty.
 * Divergence on purpose: recursion stops at the react-scripts depth bound, the substitution count and copied characters at the budget, and a value's length at its bound. Reaching any bound sets `budget.exceeded`, because the inlined value is then unknown; the caller refuses the start (Expo itself would overflow its stack on a cycle).
 * @param value - The text that may hold references.
 * @param sourceKey - The name whose value is being expanded.
 * @param sourceEnvironment - The process environment; it wins over every file.
 * @param inputEnvironment - The merged file values, expanded progressively by {@link expandExpoEnvironment}.
 * @param budget - The shared substitution budget.
 * @param depth - The current recursion depth.
 * @returns The expanded text.
 * @example interpolateExpoValue('a-${B:-x}', 'A', new Map(), new Map(), budget, 0) // => 'a-x'
 */
function interpolateExpoValue(
  value: string,
  sourceKey: string,
  sourceEnvironment: ReadonlyMap<string, string>,
  inputEnvironment: ReadonlyMap<string, string>,
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
  const recurse = (text: string, key: string): string =>
    interpolateExpoValue(
      text,
      key,
      sourceEnvironment,
      inputEnvironment,
      budget,
      depth + 1,
    )
  const expanded = value.replace(
    new RegExp(EXPO_REFERENCE_SOURCE, 'gi'),
    (
      match: string,
      escaped: string | undefined,
      _dollar: string,
      _openBrace: string,
      key: string,
      defaultValue: string | undefined,
    ): string => {
      if (budget.exceeded) return match
      if (budget.remainingSteps <= 0) return markBoundReached(budget, match)
      budget.remainingSteps -= 1
      // An escaped dollar stays literal without its backslash.
      if (escaped === '\\') return match.slice(1)
      const fromProcess = sourceEnvironment.get(key)
      if (fromProcess)
        return fromProcess === inputEnvironment.get(key)
          ? fromProcess
          : recurse(fromProcess, key)
      const fromFiles = inputEnvironment.get(key)
      if (fromFiles && key !== sourceKey) return recurse(fromFiles, key)
      if (defaultValue)
        return defaultValue.startsWith('$')
          ? recurse(defaultValue, key)
          : defaultValue
      return ''
    },
  )
  budget.remainingCopiedChars -= expanded.length
  if (
    expanded.length > REACT_SCRIPTS_ENV_VALUE_MAX_CHARS ||
    budget.remainingCopiedChars < 0
  )
    return markBoundReached(budget, expanded)
  return expanded
}

/**
 * Expands every merged file value as `@expo/env`'s `expand` does: a name the process environment also sets is expanded only when the file's value equals the process's, else it stays as written; every other value is expanded, later values seeing the earlier ones already expanded.
 * Called by {@link loadExpoEnvFiles}.
 * @param inputEnvironment - The merged file values, highest-priority file winning.
 * @param sourceEnvironment - The process environment.
 * @param budget - The shared substitution budget.
 * @returns The expanded values, `\$` turned into `$`.
 * @example expandExpoEnvironment(new Map([['A', '${B:-x}']]), new Map(), budget) // => Map { 'A' => 'x' }
 */
function expandExpoEnvironment(
  inputEnvironment: ReadonlyMap<string, string>,
  sourceEnvironment: ReadonlyMap<string, string>,
  budget: DotenvExpansionBudget,
): Map<string, string> {
  const output = new Map(inputEnvironment)
  for (const key of [...output.keys()]) {
    if (budget.exceeded) break
    const value = output.get(key) ?? ''
    // The process environment wins, so a file value that differs from it is never inlined; Expo keeps it unexpanded.
    const isOverriddenByProcess =
      sourceEnvironment.has(key) && sourceEnvironment.get(key) !== value
    const settled = isOverriddenByProcess
      ? value
      : interpolateExpoValue(value, key, sourceEnvironment, output, budget, 0)
    output.set(key, settled.replace(/\\\$/g, '$'))
  }
  return output
}

/**
 * Loads the app's development `.env` files the way `@expo/env` 2.4.3 settles them: every file is parsed, the files are merged with the highest-priority file winning, the merged values are expanded once (`${NAME:-default}` included), and a name the process environment already sets stays as it is.
 *
 * Why it exists: Expo inlines every `EXPO_PUBLIC_*` value it settles, so the mask list needs those settled values; react-scripts expands per file in another order and without defaults, so its loader cannot stand in. Called by {@link assessExpoWebWorkspace}.
 * @param appRoot - The app's folder.
 * @param environment - The process environment (the child's own); the settled file values are added in place.
 * @param policy - How an unreadable file is treated and how a refusal is worded (E-16).
 * @throws The policy's refusal for a file Codebook cannot read, or whose values expand past Codebook's bounds (the values Expo inlines are then unknown, so they could not be masked).
 * @example await loadExpoEnvFiles('/app', new Map(), policy) // .env: A=${B:-x} => environment.get('A') === 'x'
 */
export async function loadExpoEnvFiles(
  appRoot: string,
  environment: Map<string, string>,
  policy: EnvFileReadPolicy,
): Promise<void> {
  const merged = new Map<string, string>()
  // Lowest priority first, so a higher-priority file overwrites (Expo reverses the list).
  for (const name of [...EXPO_WEB_ENV_FILES].reverse()) {
    const text = await readReactScriptsEnvFile(appRoot, name, policy)
    if (text === undefined) continue
    for (const [key, value] of parseExpoEnvText(text)) merged.set(key, value)
  }
  const budget: DotenvExpansionBudget = {
    remainingSteps: REACT_SCRIPTS_ENV_EXPANSION_MAX_STEPS,
    remainingCopiedChars: REACT_SCRIPTS_ENV_EXPANSION_MAX_COPIED_CHARS,
    exceeded: false,
  }
  const expanded = expandExpoEnvironment(merged, environment, budget)
  // Past a bound the inlined values are unknown, so they could not be masked: nothing may start.
  if (budget.exceeded)
    throw policy.refusal(
      '.env',
      `its values expand past ${REACT_SCRIPTS_ENV_VALUE_MAX_CHARS} characters, ${REACT_SCRIPTS_ENV_EXPANSION_MAX_DEPTH} nested references or ${REACT_SCRIPTS_ENV_EXPANSION_MAX_STEPS} substitutions`,
    )
  // A name the process environment already sets is never overwritten.
  for (const [key, value] of expanded)
    if (!environment.has(key)) environment.set(key, value)
}
