import { open } from 'node:fs/promises'
import { basename, join } from 'node:path'

import {
  DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES,
  DEVELOPMENT_SERVER_DEFAULT_PORT,
  DEVELOPMENT_SERVER_MAX_PORT,
  DEVELOPMENT_SCRIPT_NESTING_LIMIT,
} from '../constants'

import { splitShellCommandLine } from './splitShellCommandLine'

/** Where {@link readDeclaredDevelopmentPort} found the port, named in the refusal a busy port produces. */
export type DeclaredDevelopmentPort = {
  port: number
  source: string
}

/** What a `next dev` command in a script declares: a port and which step gave it, or no port. */
type DevelopmentCommand = {
  port?: number
  via?: 'flag' | 'assignment'
  delegate?: string
}

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
function parsePort(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d{1,5}$/.test(text)) return undefined
  const port = Number(text)
  return port >= 1 && port <= DEVELOPMENT_SERVER_MAX_PORT ? port : undefined
}

/** Reads the `-p`/`--port` flag from command words (`-p 1`, `-p=1`, `-p1`, `--port 1`, `--port=1`); quotes are already removed. */
function readPortFlag(words: string[]): number | undefined {
  for (const [index, word] of words.entries()) {
    if (word === '-p' || word === '--port') return parsePort(words[index + 1])
    const attached = /^(?:-p=?|--port=)(\d+)$/.exec(word)
    if (attached) return parsePort(attached[1])
  }
  return undefined
}

/** Reads the value of a `PORT=` word: digits, or the default of a shell `${PORT:-4000}` (the owned process inherits no PORT). */
function readPortAssignment(word: string): number | undefined {
  const match = /^PORT=(?:(\d+)|\$\{PORT:-(\d+)\})$/.exec(word)
  return match ? parsePort(match[1] ?? match[2]) : undefined
}

/** The runners that execute the command after them: `cross-env A=1 cmd`, `env A=1 cmd`, `npx cmd`. */
const COMMAND_WRAPPERS = new Set(['cross-env', 'cross-env-shell', 'env', 'npx'])

/**
 * Separates a command's leading `NAME=value` words and wrappers from the program that runs.
 * @returns The `PORT` assigned before the program (if any), whether the words were an `export`/`set` statement, and the program with its arguments.
 */
function splitCommandPrefix(words: string[]): {
  port?: number
  exported: boolean
  program: string[]
} {
  let port: number | undefined
  let exported = false
  let index = 0
  for (; index < words.length; index += 1) {
    const word = words[index]!
    if (word === 'export' || word === 'set') exported = true
    else if (/^\w+=/.test(word)) port = readPortAssignment(word) ?? port
    else if (COMMAND_WRAPPERS.has(word)) continue
    else if (/^(?:pnpm|npm|yarn)$/.test(word) && words[index + 1] === 'exec')
      index += 1
    // A flag of a wrapper (`npx -y`, `npm exec --`) is not the program.
    else if (index > 0 && word.startsWith('-')) continue
    else break
  }
  return { port, exported, program: words.slice(index) }
}

/** Reads the port of a program that is `next` (also by path or `node .../next`); `undefined` for another program or another `next` subcommand such as `build`. */
function readNextProgram(program: string[]): DevelopmentCommand | undefined {
  const args = program[0] === 'node' ? program.slice(1) : program
  if (basename(args[0] ?? '') !== 'next') return undefined
  const rest = args.slice(1)
  // Only `next dev` (or a bare `next`, which is dev) starts the server.
  if (rest[0] && !rest[0].startsWith('-') && rest[0] !== 'dev') return undefined
  const port = readPortFlag(rest)
  return port === undefined ? {} : { port, via: 'flag' }
}

/** Reads the package-manager forms that start another script: `npm run x`, `pnpm x`, `pnpm run x`, `yarn x`, `bun run x`. */
function readDelegation(
  program: string[],
): { name: string; args: string[] } | undefined {
  const [manager, first, second] = program
  if (!/^(?:npm|pnpm|yarn|bun)$/.test(manager ?? '')) return undefined
  const viaRun =
    first === 'run' || (manager === 'npm' && first === 'run-script')
  const bare = manager === 'pnpm' || manager === 'yarn'
  const name = viaRun ? second : bare ? first : undefined
  if (!name || name.startsWith('-')) return undefined
  return { name, args: program.slice(viaRun ? 3 : 2) }
}

/**
 * Finds the `next dev` command in one script and the port it would use, as the shell would run it.
 * The first command that is `next dev` (or delegates to a script that runs it) decides.
 */
function readCommandLine(
  line: string,
  scripts: Record<string, unknown> | undefined,
  depth: number,
): DevelopmentCommand | undefined {
  let exportedPort: number | undefined
  for (const words of splitShellCommandLine(line)) {
    const { port: prefixed, exported, program } = splitCommandPrefix(words)
    if (exported) {
      exportedPort = prefixed ?? exportedPort
      continue
    }
    const found = readProgram(program, prefixed ?? exportedPort, scripts, depth)
    if (found) return found
  }
  return undefined
}

/** Reads one program (after its prefix): `next`, `concurrently`'s quoted commands, or a package-manager delegation. */
function readProgram(
  program: string[],
  assigned: number | undefined,
  scripts: Record<string, unknown> | undefined,
  depth: number,
): DevelopmentCommand | undefined {
  const next = readNextProgram(program)
  if (next)
    return next.port === undefined && assigned !== undefined
      ? { port: assigned, via: 'assignment' }
      : next
  if (program[0] === 'concurrently' && depth < DEVELOPMENT_SCRIPT_NESTING_LIMIT)
    for (const word of program.slice(1)) {
      // A quoted command holds blanks; a plain argument (a flag, a name) does not.
      const quoted = /\s/.test(word)
        ? readCommandLine(word, scripts, depth + 1)
        : undefined
      if (quoted) return quoted
    }
  return readDelegatedScript(program, assigned, scripts, depth)
}

/** Follows `npm run x` and its kin one level into script `x`: arguments after the name win, then the script's own declaration, then the assignment before the delegation. */
function readDelegatedScript(
  program: string[],
  assigned: number | undefined,
  scripts: Record<string, unknown> | undefined,
  depth: number,
): DevelopmentCommand | undefined {
  const delegation = scripts ? readDelegation(program) : undefined
  const script = delegation && scripts?.[delegation.name]
  if (!delegation || typeof script !== 'string') return undefined
  // The delegated script is read without scripts, so it cannot delegate again.
  const inner = readCommandLine(script, undefined, depth + 1)
  if (!inner) return undefined
  const delegate = delegation.name
  const flag = readPortFlag(delegation.args)
  if (flag !== undefined) return { port: flag, via: 'flag', delegate }
  if (inner.port !== undefined) return { ...inner, delegate }
  return assigned === undefined
    ? { delegate }
    : { port: assigned, via: 'assignment', delegate }
}

/** Names the step that gave the port, for the refusal and the run resource. */
function describeSource(found: DevelopmentCommand): string {
  const where = found.delegate
    ? `the "${found.delegate}" script that the dev script runs in package.json`
    : 'the dev script in package.json'
  return found.via === 'assignment' ? `a PORT assignment in ${where}` : where
}

/**
 * Finds the port the project's own `dev` script would start `next dev` on, so the app runs on the origin its auth and callback settings point to.
 *
 * Called during repository-browser preparation by {@link ConfiguredBrowserRun}, before {@link launchDevelopmentServer}.
 * The order follows what Next does with its command line and environment: the `-p`/`--port` of the `next dev` command, else a `PORT=` the script itself assigns, else Next's default. `.env*` files are not read because Next reads `PORT` before it loads them. One level of delegation (`npm run`, `pnpm`, `yarn`, `bun run`) is followed.
 *
 * @param root - The trusted workspace root that holds `package.json`.
 * @returns The port and a short description of the step that gave it.
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
  let scripts: Record<string, unknown> | undefined
  try {
    const declared: unknown = JSON.parse(packageText ?? '')?.scripts
    if (declared && typeof declared === 'object')
      scripts = declared as Record<string, unknown>
  } catch {
    // A package.json that is absent or not JSON declares nothing; Next itself will report it.
  }
  const dev = scripts?.dev
  const found =
    typeof dev === 'string' ? readCommandLine(dev, scripts, 0) : undefined
  if (found?.port !== undefined)
    return { port: found.port, source: describeSource(found) }
  return {
    port: DEVELOPMENT_SERVER_DEFAULT_PORT,
    source: "Next's default port",
  }
}
