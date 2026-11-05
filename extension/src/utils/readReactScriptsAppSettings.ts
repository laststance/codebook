import { z } from 'zod'

import {
  REACT_SCRIPTS_ENV_EXPANSION_MAX_COPIED_CHARS,
  REACT_SCRIPTS_ENV_EXPANSION_MAX_DEPTH,
  REACT_SCRIPTS_ENV_EXPANSION_MAX_STEPS,
  REACT_SCRIPTS_ENV_VALUE_MAX_CHARS,
} from '../constants'
import { reactScriptsEnvFileRefusal } from '../reactScriptsRefusals'

import { expandDotenvFile } from './expandDotenvFile'
import {
  buildReactScriptsEnvironment,
  declaredReactScriptsPort,
} from './reactScriptsChildEnvironment'
import { readReactScriptsEnvFile } from './readReactScriptsEnvFile'
import { readJsonInside } from './resolveNextPackage'

/** What the app's own files declare that decides how its development server is reached and what its bundle holds. */
export type ReactScriptsAppSettings = {
  /** The environment react-scripts settles: the child's own environment with the app's `.env` files loaded over it and expanded the way dotenv-expand does. */
  environment: Record<string, string>
  /** The `homepage` of the app's `package.json`, when it is a string. */
  homepage: string | undefined
}

/** The development env files in the order react-scripts loads them: the first file that sets a name wins. */
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
 * @returns The names and values the file sets, in file order.
 * @example parseEnvText('A=1\nB="x\\ny"') // => Map { 'A' => '1', 'B' => 'x\ny' }
 */
function parseEnvText(text: string): Map<string, string> {
  const values = new Map<string, string>()
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
    values.set(match[1]!, value)
  }
  return values
}

/** Reads the `homepage` of the app's `package.json` (bounded, regular file only). @example await readHomepage('/app') // => 'https://example.com/app' */
async function readHomepage(appRoot: string): Promise<string | undefined> {
  const manifest = await readJsonInside(appRoot, 'package.json', z.unknown())
  if (typeof manifest !== 'object' || manifest === null) return undefined
  const homepage = 'homepage' in manifest ? manifest.homepage : undefined
  return typeof homepage === 'string' ? homepage : undefined
}

/**
 * Reads what a react-scripts app declares in its own files: the environment react-scripts settles (the child's environment with the `.env` files loaded and expanded in react-scripts' order) and the `homepage`.
 *
 * Why it exists: `PUBLIC_URL` and `homepage` move the served bundle, `HTTPS=true` cannot be observed over `http://`, and every `REACT_APP_*` value is inlined into the bundle the run archives, so the mask list needs the values react-scripts settles. Called by {@link assessReactScriptsWorkspace}.
 * @param appRoot - The app's folder.
 * @param assignments - The accepted `start` script's assignments; with Codebook's own values they are the process environment, which `.env` never overrides.
 * @returns The settled environment and the homepage.
 * @throws `REACT_SCRIPTS_UNSUPPORTED` (`env-file-unreadable`) for an `.env` file over the limit or not a regular file, or one whose values expand past Codebook's bounds.
 * @example await readReactScriptsAppSettings('/app', { PORT: '3000' }) // => { environment: { PORT: '3000', REACT_APP_KEY: 'k', … }, homepage: undefined }
 */
export async function readReactScriptsAppSettings(
  appRoot: string,
  assignments: Readonly<Record<string, string>>,
): Promise<ReactScriptsAppSettings> {
  const scriptAssignments = { ...assignments }
  const childEnvironment = buildReactScriptsEnvironment(
    scriptAssignments,
    declaredReactScriptsPort(scriptAssignments).port,
  )
  const environment = new Map<string, string>()
  for (const [name, value] of Object.entries(childEnvironment))
    if (value !== undefined) environment.set(name, value)
  // react-scripts' start.js sets both before env.js loads the .env files, so a reference to them settles to development.
  environment.set('BABEL_ENV', 'development')
  environment.set('NODE_ENV', 'development')
  const budget = {
    remainingSteps: REACT_SCRIPTS_ENV_EXPANSION_MAX_STEPS,
    remainingCopiedChars: REACT_SCRIPTS_ENV_EXPANSION_MAX_COPIED_CHARS,
    exceeded: false,
  }
  // Files load one after the other, as react-scripts' env.js does; each sees what the earlier ones set.
  for (const name of ENV_FILES) {
    const text = await readReactScriptsEnvFile(appRoot, name)
    if (text === undefined) continue
    expandDotenvFile(parseEnvText(text), environment, budget)
    // Past a bound the values react-scripts inlines are unknown, so they could not be masked: nothing may start.
    if (budget.exceeded)
      throw reactScriptsEnvFileRefusal(
        name,
        `its values expand past ${REACT_SCRIPTS_ENV_VALUE_MAX_CHARS} characters, ${REACT_SCRIPTS_ENV_EXPANSION_MAX_DEPTH} nested references or ${REACT_SCRIPTS_ENV_EXPANSION_MAX_STEPS} substitutions`,
      )
  }
  return {
    environment: Object.fromEntries(environment),
    homepage: await readHomepage(appRoot),
  }
}
