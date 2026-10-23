import { open } from 'node:fs/promises'
import { join } from 'node:path'

import {
  DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES,
  DEVELOPMENT_SERVER_DEFAULT_PORT,
  DEVELOPMENT_SERVER_MAX_PORT,
} from '../constants'

import { buildDevelopmentServerEnvironment } from './developmentServerEnvironment'
import {
  expandDotenvFile,
  parseDotenv,
  type EnvironmentTable,
} from './expandNextEnvironment'

/** Where {@link readDeclaredDevelopmentPort} found the port, named in the refusal a busy port produces. */
export type DeclaredDevelopmentPort = {
  port: number
  source: string
}

/** Next loads these in this order for `next dev`; the first file that sets a variable wins. */
const ENVIRONMENT_FILES_BY_PRECEDENCE = [
  '.env.development.local',
  '.env.local',
  '.env.development',
  '.env',
] as const

/** Reads one project file up to the source limit; `undefined` when it is absent or unreadable. */
async function readProjectFile(path: string): Promise<string | undefined> {
  const handle = await open(path, 'r').catch(() => undefined)
  if (!handle) return undefined
  try {
    const buffer = Buffer.alloc(DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES)
    const { bytesRead } = await handle.read(
      buffer,
      0,
      DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES,
      0,
    )
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return undefined
  } finally {
    await handle.close()
  }
}

/** Accepts only a whole decimal TCP port; anything else (`$PORT`, `0`, `99999`) is not a declaration. */
function parsePort(text: string): number | undefined {
  if (!/^\d{1,5}$/.test(text)) return undefined
  const port = Number(text)
  return port >= 1 && port <= DEVELOPMENT_SERVER_MAX_PORT ? port : undefined
}

/** Reads the `-p`/`--port` flag from command text (`-p 1`, `-p=1`, `-p1`, `--port 1`, `--port=1`). */
function readPortFlag(text: string): number | undefined {
  const match = /(?:^|\s)(?:-p\s*=?\s*|--port(?:=|\s+))(\d+)(?=\s|$)/.exec(text)
  return match ? parsePort(match[1]!) : undefined
}

/** Reads a `PORT=4000` assignment (also after `export`, `set` or `cross-env`) from the text that precedes a command. */
function readPortAssignment(text: string): number | undefined {
  const match = /(?:^|\s)PORT=["']?(\d+)["']?(?=\s|&|$)/.exec(text)
  return match ? parsePort(match[1]!) : undefined
}

/** A command that only runs another package script: `npm run x`, `pnpm x`, `pnpm run x`, `yarn x`, `bun run x`. */
const SCRIPT_DELEGATION =
  /^\s*(?:npm\s+(?:run|run-script)|pnpm(?:\s+run)?|yarn(?:\s+run)?|bun\s+run)\s+([\w][\w:.-]*)(.*)$/

/** Reads the port of one command that runs `next`: its flag (which beats PORT in Next's own CLI), else a `PORT=` before it, else one assigned earlier in the chain. */
function readNextCommandPort(
  command: string,
  assigned: number | undefined,
): number | undefined {
  return (
    readPortFlag(command) ??
    readPortAssignment(command.slice(0, command.search(/\bnext\b/))) ??
    assigned
  )
}

/** Follows a command that only runs another package script (`pnpm web -- -p 4000`) into that script, one level; arguments after the name win over the script's own. */
function readDelegatedPort(
  command: string,
  scripts: Record<string, unknown>,
): { port: number; delegate: string } | undefined {
  const delegation = SCRIPT_DELEGATION.exec(command)
  const delegated = delegation ? scripts[delegation[1]!] : undefined
  if (!delegation || typeof delegated !== 'string') return undefined
  const port =
    readPortFlag(delegation[2]!) ?? readScriptPort(delegated, undefined)?.port
  return port === undefined ? undefined : { port, delegate: delegation[1]! }
}

/**
 * Finds the port of the `next` command inside a script: its `-p`/`--port` flag, else a `PORT=` assignment before it.
 * A command that delegates to another script is followed one level when `scripts` is given.
 */
function readScriptPort(
  script: string,
  scripts: Record<string, unknown> | undefined,
): { port: number; delegate?: string } | undefined {
  let assigned: number | undefined
  // Only a command that runs next can own the flag; `mkdir -p 3` in a chain must not.
  for (const command of script.split(/&&|\|\||;|\|/)) {
    if (/\bnext\b/.test(command)) {
      const port = readNextCommandPort(command, assigned)
      if (port !== undefined) return { port }
      continue
    }
    assigned = readPortAssignment(command) ?? assigned
    const delegated = scripts && readDelegatedPort(command, scripts)
    if (delegated) return delegated
  }
  return undefined
}

/**
 * Finds the `PORT` Next would load from the project's env files.
 * Files load in Next's precedence and `$VAR` references expand against the owned process's environment and the files before, as `@next/env` does; only the `PORT` result leaves this function.
 */
async function readEnvironmentPort(
  root: string,
): Promise<DeclaredDevelopmentPort | undefined> {
  const environment: EnvironmentTable = new Map()
  // Next expands against its own environment, which is the owned process's allow-list, never the extension host's other variables.
  for (const [name, value] of Object.entries(
    buildDevelopmentServerEnvironment(),
  ))
    if (value !== undefined) environment.set(name, value)
  let source: string | undefined
  for (const name of ENVIRONMENT_FILES_BY_PRECEDENCE) {
    const text = await readProjectFile(join(root, name))
    if (text === undefined) continue
    const parsed = parseDotenv(text)
    // The first file that sets PORT decides, whatever its value turns out to be.
    if (parsed.has('PORT') && !environment.has('PORT')) source = name
    expandDotenvFile(parsed, environment)
  }
  const port = parsePort(environment.get('PORT') ?? '')
  return port !== undefined && source
    ? { port, source: `PORT in ${source}` }
    : undefined
}

/**
 * Finds the port a project declares for its own development server, so the app runs on the origin its auth and callback settings point to.
 *
 * Called during repository-browser preparation by {@link ConfiguredBrowserRun}, before {@link launchDevelopmentServer}.
 * The order is the `dev` script's port (its flag, a `PORT=` before `next`, or the same in the one script it delegates to), then a `PORT` in the env files (Next's precedence and `$VAR` expansion), then Next's default.
 *
 * @param root - The trusted workspace root that holds `package.json`.
 * @returns The port and a short description of where it was declared.
 *
 * @example
 * ```ts
 * await readDeclaredDevelopmentPort('/repo') // { port: 3165, source: 'the dev script in package.json' }
 * ```
 */
export async function readDeclaredDevelopmentPort(
  root: string,
): Promise<DeclaredDevelopmentPort> {
  const packageText = await readProjectFile(join(root, 'package.json'))
  if (packageText !== undefined) {
    let scripts: Record<string, unknown> | undefined
    try {
      const declared: unknown = JSON.parse(packageText)?.scripts
      if (declared && typeof declared === 'object')
        scripts = declared as Record<string, unknown>
    } catch {
      // A package.json that is not JSON declares nothing; Next itself will report it.
    }
    const script = scripts?.dev
    const found =
      typeof script === 'string' ? readScriptPort(script, scripts) : undefined
    if (found)
      return {
        port: found.port,
        source: found.delegate
          ? `the "${found.delegate}" script that the dev script runs in package.json`
          : 'the dev script in package.json',
      }
  }
  const fromEnvironment = await readEnvironmentPort(root)
  if (fromEnvironment) return fromEnvironment
  return {
    port: DEVELOPMENT_SERVER_DEFAULT_PORT,
    source: "Next's default port",
  }
}
