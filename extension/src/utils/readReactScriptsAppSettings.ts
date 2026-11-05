import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES } from '../constants'

/** What the app's own files declare that decides how its development server is reached and what its bundle holds. */
export type ReactScriptsAppSettings = {
  /** The environment react-scripts runs with: the start script's assignments over the app's `.env` files. */
  environment: Record<string, string>
  /** The `homepage` of the app's `package.json`, when it is a string. */
  homepage: string | undefined
}

/** The development env files in react-scripts' precedence: the first file that sets a name wins. */
const ENV_FILES = [
  '.env.development.local',
  '.env.local',
  '.env.development',
  '.env',
] as const

/** One `NAME=value` line the way dotenv 10 (react-scripts 5) reads it. */
const ENV_LINE = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/

/**
 * Parses one `.env` text with the rules of dotenv 10: `NAME=value` lines, matching quotes stripped, `\n` expanded inside double quotes.
 * @param text - The file text.
 * @returns The names and values the file sets.
 * @example parseEnvText('A=1\nB="x\\ny"') // => { A: '1', B: 'x\ny' }
 */
function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split(/\r\n|\r|\n/)) {
    const match = ENV_LINE.exec(line)
    if (!match) continue
    let value = (match[2] ?? '').trim()
    const quote = value[0]
    const isQuoted =
      value.length > 1 &&
      (quote === '"' || quote === "'") &&
      value.endsWith(quote)
    if (isQuoted) {
      value = value.slice(1, -1)
      // Only double quotes expand escaped newlines.
      if (quote === '"') value = value.replaceAll('\\n', '\n')
    }
    values[match[1]!] = value
  }
  return values
}

/**
 * Expands `$NAME` and `${NAME}` the way dotenv-expand does, from the settled environment; `\$` stays a literal dollar.
 * @param value - A value that may reference others.
 * @param environment - The environment the references resolve in.
 * @returns The expanded value; an unknown name becomes empty.
 * @example expandEnvValue('${A}/x', { A: 'a' }) // => 'a/x'
 */
function expandEnvValue(
  value: string,
  environment: Readonly<Record<string, string>>,
): string {
  return value.replace(
    /(\\)?\$(?:\{(\w+)\}|(\w+))/g,
    (whole, escaped: string | undefined, braced?: string, bare?: string) =>
      escaped ? whole.slice(1) : (environment[braced ?? bare ?? ''] ?? ''),
  )
}

/** Reads one env file of the app, or an empty text when it is absent, unreadable or over the limit. @example await readEnvFile('/app', '.env') // => 'A=1\n' */
async function readEnvFile(appRoot: string, name: string): Promise<string> {
  const text = await readFile(join(appRoot, name), 'utf8').catch(() => '')
  return text.length > REACT_SCRIPTS_ENV_FILE_LIMIT_BYTES ? '' : text
}

/** Reads the `homepage` of the app's `package.json`. @example await readHomepage('/app') // => 'https://example.com/app' */
async function readHomepage(appRoot: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(appRoot, 'package.json'), 'utf8'),
    )
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const homepage = 'homepage' in parsed ? parsed.homepage : undefined
    return typeof homepage === 'string' ? homepage : undefined
  } catch {
    return undefined
  }
}

/**
 * Reads what a react-scripts app declares in its own files: the environment react-scripts builds (script assignments over the `.env` files, in react-scripts' precedence) and the `homepage`.
 *
 * Why it exists: `PUBLIC_URL` and `homepage` move the served bundle, `HTTPS=true` cannot be observed over `http://`, and every `REACT_APP_*` value is inlined into the bundle the run archives. Called by {@link assessReactScriptsWorkspace}.
 * @param appRoot - The app's folder.
 * @param assignments - The accepted `start` script's assignments; they act as process environment, which `.env` never overrides.
 * @returns The settled environment and the homepage.
 * @example await readReactScriptsAppSettings('/app', { PORT: '3000' }) // => { environment: { PORT: '3000', REACT_APP_KEY: 'k' }, homepage: undefined }
 */
export async function readReactScriptsAppSettings(
  appRoot: string,
  assignments: Readonly<Record<string, string>>,
): Promise<ReactScriptsAppSettings> {
  const parsedFiles = await Promise.all(
    ENV_FILES.map(async (name) =>
      parseEnvText(await readEnvFile(appRoot, name)),
    ),
  )
  const environment: Record<string, string> = { ...assignments }
  // The first file that sets a name wins, and a script assignment beats every file.
  for (const values of parsedFiles)
    for (const [name, value] of Object.entries(values))
      if (!(name in environment)) environment[name] = value
  for (const [name, value] of Object.entries(environment))
    environment[name] = expandEnvValue(value, environment)
  return { environment, homepage: await readHomepage(appRoot) }
}
