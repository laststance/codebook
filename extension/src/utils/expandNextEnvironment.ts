import { DEVELOPMENT_ENV_EXPANSION_STEP_LIMIT } from '../constants'

/** A variable table; a `Map` so that names like `__proto__` are plain keys. */
export type EnvironmentTable = Map<string, string>

/** Next's own dotenv grammar (`KEY=value`, `KEY: value`, `export KEY=value`, quotes, `#` comments), copied from the dotenv bundled in `@next/env`. */
const DOTENV_LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm
const UNESCAPED_DOLLAR = /(?!(?<=\\))\$/g
const VARIABLE_REFERENCE = /((?!(?<=\\))\${?([\w]+)(?::-([^}\\]*))?}?)/

/**
 * Parses one env file the way Next does (dotenv): a later duplicate wins, an inline `#` ends an unquoted value.
 *
 * Called by {@link readDeclaredDevelopmentPort} for each env file. Values stay in memory; callers surface only the port.
 *
 * @param text - The file's text.
 * @returns Every variable of the file with its raw (not yet expanded) value.
 *
 * @example
 * ```ts
 * parseDotenv('PORT=3165#x\nPORT: 4000').get('PORT') // '4000'
 * ```
 */
export function parseDotenv(text: string): EnvironmentTable {
  const parsed: EnvironmentTable = new Map()
  const lines = text.replace(/\r\n?/gm, '\n')
  for (const match of lines.matchAll(new RegExp(DOTENV_LINE))) {
    let value = (match[2] ?? '').trim()
    const quote = value[0]
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, '$2')
    if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
    parsed.set(match[1]!, value)
  }
  return parsed
}

/** Substitutes `$VAR`, `${VAR}` and `${VAR:-fallback}` from the last reference backwards, as dotenv-expand does; `undefined` when the value never settles. */
function interpolate(
  value: string,
  environment: EnvironmentTable,
  parsed: EnvironmentTable,
): string | undefined {
  let current = value
  for (let step = 0; step < DEVELOPMENT_ENV_EXPANSION_STEP_LIMIT; step += 1) {
    const dollars = [...current.matchAll(UNESCAPED_DOLLAR)]
    if (dollars.length === 0) return current
    const reference = VARIABLE_REFERENCE.exec(
      current.slice(dollars[dollars.length - 1]!.index),
    )
    // A `$` that names no variable stays as written.
    if (!reference) return current
    const [, whole, name, fallback] = reference
    const replacement =
      environment.get(name!) || fallback || parsed.get(name!) || ''
    current = current.replace(whole!, () => replacement)
  }
  return undefined
}

/**
 * Expands one parsed env file in place and adds its variables to the environment, mirroring `@next/env`'s load of a file.
 *
 * A variable that the environment already holds (the process's own, or one an earlier, higher-precedence file set) keeps its value, which is how Next's precedence arises.
 * References resolve against the environment first, then the file's own variables.
 *
 * @param parsed - The file's variables from {@link parseDotenv}; replaced by their expanded values.
 * @param environment - The variables Next sees so far; receives the file's variables.
 *
 * @example
 * ```ts
 * const environment = new Map<string, string>()
 * const parsed = parseDotenv('APP_PORT=3165\nPORT=$APP_PORT')
 * expandDotenvFile(parsed, environment) // environment.get('PORT') === '3165'
 * ```
 */
export function expandDotenvFile(
  parsed: EnvironmentTable,
  environment: EnvironmentTable,
): void {
  for (const name of [...parsed.keys()]) {
    const raw = environment.has(name)
      ? environment.get(name)!
      : parsed.get(name)!
    const settled = interpolate(raw, environment, parsed)
    // A value that never settles is empty, so it can never read as a port.
    parsed.set(name, (settled ?? '').replace(/\\\$/g, '$'))
  }
  for (const [name, value] of parsed) environment.set(name, value)
}
