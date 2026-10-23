import { open } from 'node:fs/promises'
import { join } from 'node:path'

import {
  DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES,
  DEVELOPMENT_SERVER_DEFAULT_PORT,
  DEVELOPMENT_SERVER_MAX_PORT,
} from '../constants'

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

/** Finds the `-p`/`--port` of the `next` command inside a `dev` script (`-p 1`, `-p=1`, `-p1`, `--port 1`, `--port=1`). */
function readScriptPort(script: string): number | undefined {
  // Only a command that runs next can own the flag; `mkdir -p 3` in a chain must not.
  for (const command of script.split(/&&|\|\||;|\|/)) {
    if (!/\bnext\b/.test(command)) continue
    const match = /(?:^|\s)(?:-p\s*=?\s*|--port(?:=|\s+))(\d+)(?=\s|$)/.exec(
      command,
    )
    const port = match ? parsePort(match[1]!) : undefined
    if (port !== undefined) return port
  }
  return undefined
}

/** Reads only the `PORT` line of an env file; every other line holds values that may be secrets and is never kept. */
function readEnvironmentPort(text: string): number | undefined {
  const match = /^[ \t]*(?:export[ \t]+)?PORT[ \t]*=[ \t]*(.*)$/m.exec(text)
  if (!match) return undefined
  // Drop a trailing comment and surrounding quotes before the digits are judged.
  const value = match[1]!
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
  return parsePort(value)
}

/**
 * Finds the port a project declares for its own development server, so the app runs on the origin its auth and callback settings point to.
 *
 * Called during repository-browser preparation by {@link ConfiguredBrowserRun}, before {@link launchDevelopmentServer}.
 * The order is the `dev` script's port flag, then a `PORT` in the env files (Next's precedence), then Next's default.
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
    let script: unknown
    try {
      script = JSON.parse(packageText)?.scripts?.dev
    } catch {
      // A package.json that is not JSON declares nothing; Next itself will report it.
    }
    const port = typeof script === 'string' ? readScriptPort(script) : undefined
    if (port !== undefined)
      return { port, source: 'the dev script in package.json' }
  }
  for (const name of ENVIRONMENT_FILES_BY_PRECEDENCE) {
    const text = await readProjectFile(join(root, name))
    const port = text === undefined ? undefined : readEnvironmentPort(text)
    if (port !== undefined) return { port, source: `PORT in ${name}` }
  }
  return {
    port: DEVELOPMENT_SERVER_DEFAULT_PORT,
    source: "Next's default port",
  }
}
