import { access, open } from 'node:fs/promises'
import { join } from 'node:path'

import {
  DEVELOPMENT_BUN_ENV_UNREAD_REASON,
  DEVELOPMENT_BUN_LOCKFILES,
  DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES,
  DEVELOPMENT_SCRIPT_NESTING_LIMIT,
  DEVELOPMENT_SCRIPT_PACKAGE_MANAGER_COMMANDS,
  DEVELOPMENT_SCRIPT_UNREAD_SEGMENT_MAX_CHARS,
  DEVELOPMENT_SCRIPT_UNSAFE_ASSIGNMENT_NAME,
  DEVELOPMENT_SCRIPT_VALUELESS_NEXT_FLAGS,
  DEVELOPMENT_SERVER_DEFAULT_PORT,
  DEVELOPMENT_SERVER_MAX_PORT,
} from '../constants'

import { cutTextToFit } from './cutTextToFit'
import {
  showDevelopmentScriptSegment,
  showScriptName,
} from './showDevelopmentScriptSegment'
import {
  tokenizeDevelopmentScript,
  UnreadScriptError,
} from './tokenizeDevelopmentScript'

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

/** Whether the repository root holds a Bun lockfile; only existence is checked, no content is read (F499). */
async function hasBunLockfile(root: string): Promise<boolean> {
  const found = await Promise.all(
    DEVELOPMENT_BUN_LOCKFILES.map((name) =>
      access(join(root, name)).then(
        () => true,
        () => false,
      ),
    ),
  )
  return found.includes(true)
}

/** What a line is read against: the project's `scripts`. */
type Scripts = Record<string, unknown> | undefined

/** The exported `PORT` the programs of a line run with: set only by `export PORT=N` or an assignment before the command. */
type PortEnv = { port?: number }

/** A flag of `next dev` split into its name and an attached value: `--port=4000`, `-p4000`; `value` is `undefined` when the word is the bare flag. */
type SplitFlag = { name: string; value?: string }

/** The values the grammar accepts for `-H`/`--hostname` and for the paths of `--experimental-https-*`. */
const HOSTNAME_VALUE = /^[\w.:-]+$/
const PATH_VALUE = /^[\w./@%+-]+$/
/** A `NAME=value` word the grammar accepts: the value is literal. */
const ASSIGNMENT = /^([A-Za-z_]\w*)=([\w.,:/@%+=-]*)$/
/** The `next` program the grammar accepts: `next`, or a path that ends in `node_modules/.bin/next`. */
const NEXT_PROGRAM = /^(?:next|(?:.*\/)?node_modules\/\.bin\/next)$/

/** Accepts only a whole decimal TCP port in 1..65535; anything else (`$PORT`, `0`, `99999`) is outside the grammar. @throws {@link UnreadScriptError} For any other text. */
function parsePort(text: string | undefined): number {
  if (text === undefined || !/^\d{1,5}$/.test(text))
    throw new UnreadScriptError()
  const port = Number(text)
  if (port < 1 || port > DEVELOPMENT_SERVER_MAX_PORT)
    throw new UnreadScriptError()
  return port
}

/** Splits a flag of `next dev`: `--name=value`, `-Xvalue` or the bare flag. */
function splitFlag(word: string): SplitFlag {
  if (word.startsWith('--')) {
    const equals = word.indexOf('=')
    return equals < 0
      ? { name: word }
      : { name: word.slice(0, equals), value: word.slice(equals + 1) }
  }
  return word.length > 2
    ? { name: word.slice(0, 2), value: word.slice(2) }
    : { name: word }
}

/** The value a flag takes: its attached value, else the next word (the index moves past it). @throws {@link UnreadScriptError} When the flag has no value or the value is not one the grammar accepts. */
function takeFlagValue(
  flag: SplitFlag,
  words: readonly string[],
  cursor: { index: number },
  accepts: RegExp,
): string {
  let value = flag.value
  if (value === undefined) {
    cursor.index += 1
    value = words[cursor.index]
  }
  if (value === undefined || value.startsWith('-') || !accepts.test(value))
    throw new UnreadScriptError()
  return value
}

/**
 * Reads the flags after `next dev`: `-p`/`--port` (`-p N`, `-pN`, `--port N`, `--port=N`), `-H`/`--hostname`, `--turbo`, `--turbopack`, `--webpack`, `--experimental-https` and `--experimental-https-*` with a literal value. The last port wins, as in Next's own parser (F452).
 * @returns The last port flag's port, or `undefined` when none is given.
 * @throws {@link UnreadScriptError} For any other word or an invalid value.
 */
function readNextDevFlags(words: readonly string[]): number | undefined {
  let port: number | undefined
  const cursor = { index: 0 }
  for (; cursor.index < words.length; cursor.index += 1) {
    const word = words[cursor.index]!
    if (!word.startsWith('-')) throw new UnreadScriptError()
    const flag = splitFlag(word)
    if (flag.name === '-p' || flag.name === '--port') {
      // The port must be the flag's value: `-p=4000` is no port.
      port = parsePort(takeFlagValue(flag, words, cursor, /^\d+$/))
    } else if (flag.name === '-H' || flag.name === '--hostname') {
      takeFlagValue(flag, words, cursor, HOSTNAME_VALUE)
    } else if (/^--experimental-https-[a-z-]+$/.test(flag.name)) {
      takeFlagValue(flag, words, cursor, PATH_VALUE)
    } else if (!DEVELOPMENT_SCRIPT_VALUELESS_NEXT_FLAGS.has(word)) {
      throw new UnreadScriptError()
    }
  }
  return port
}

/** The words after the launcher when the program is `next` reached by an allowed launcher (`next`, `npx next`, `bunx next`, `pnpm exec next`, `yarn next`, a `node_modules/.bin/next` path), else `undefined`. */
function nextArguments(
  program: string[],
  scripts: Scripts,
): string[] | undefined {
  const [first, second, third] = program
  if (NEXT_PROGRAM.test(first ?? '')) return program.slice(1)
  if ((first === 'npx' || first === 'bunx') && NEXT_PROGRAM.test(second ?? ''))
    return program.slice(2)
  if (first === 'pnpm' && second === 'exec' && NEXT_PROGRAM.test(third ?? ''))
    return program.slice(3)
  // `yarn next` runs a script named next when the project has one.
  if (
    first === 'yarn' &&
    second === 'next' &&
    typeof scripts?.next !== 'string'
  )
    return program.slice(2)
  return undefined
}

/** Reads a `next dev` command: only `dev` and the allowed flags. @throws {@link UnreadScriptError} For `next build`, a positional word or any other flag, and, when Bun runs the line, for a command with no port flag and no `PORT` assigned in the script, since a `.env` file may set it (F499). */
function readNextDevCommand(
  args: string[],
  env: PortEnv,
  scope: LineScope,
): DevelopmentCommand {
  if (args[0] !== 'dev') throw new UnreadScriptError()
  const port = readNextDevFlags(args.slice(1))
  if (port !== undefined) return { port, via: 'flag' }
  if (env.port !== undefined) return { port: env.port, via: 'assignment' }
  if (scope.bun) throw new UnreadScriptError([], true)
  return {}
}

/** The script a delegation without arguments names: `npm run x`, `pnpm x`, `pnpm run x`, `yarn x`, `yarn run x`, `bun run x`; `undefined` for any other program. */
function delegatedScriptName(program: string[]): string | undefined {
  const [manager, first, second] = program
  const viaRun =
    program.length === 3 &&
    first !== undefined &&
    (first === 'run' || (manager === 'npm' && first === 'run-script'))
  if (viaRun && ['npm', 'pnpm', 'yarn', 'bun'].includes(manager!)) return second
  const bare =
    program.length === 2 &&
    (manager === 'pnpm' || manager === 'yarn') &&
    first !== undefined &&
    !first.startsWith('-') &&
    !DEVELOPMENT_SCRIPT_PACKAGE_MANAGER_COMMANDS.has(first)
  return bare ? first : undefined
}

/** What one line is read with: the project's scripts, how deep the reader already is, and whether Bun runs it (a Bun project, or a script reached by `bun run`), so that its `.env` files may set `PORT` (F499). */
type LineScope = { scripts: Scripts; depth: number; bun: boolean }

/** Steps into another command line one level deeper. @throws {@link UnreadScriptError} At {@link DEVELOPMENT_SCRIPT_NESTING_LIMIT}. */
function descend(scope: LineScope): LineScope {
  if (scope.depth >= DEVELOPMENT_SCRIPT_NESTING_LIMIT)
    throw new UnreadScriptError()
  return { ...scope, depth: scope.depth + 1 }
}

/** Reads a delegation: the script runs with the exported `PORT` of the delegating command, and the script that finally runs `next dev` is named. */
function readDelegation(
  name: string,
  env: PortEnv,
  scope: LineScope,
  viaBun: boolean,
): DevelopmentCommand | undefined {
  const script = Object.hasOwn(scope.scripts ?? {}, name)
    ? scope.scripts?.[name]
    : undefined
  if (typeof script !== 'string') throw new UnreadScriptError()
  // A script reached by `bun run` runs with Bun's `.env` loading, whatever starts it further down (F499).
  const inner = readLine(script, env, {
    ...descend(scope),
    bun: scope.bun || viaBun,
  })
  return inner && { ...inner, delegate: inner.delegate ?? name }
}

/** Reads `concurrently` with only quoted commands, each read by the grammar; exactly one of them must run `next dev`. */
function readConcurrently(
  args: string[],
  env: PortEnv,
  scope: LineScope,
): DevelopmentCommand {
  // A quoted command holds a blank; a flag, a name or a reference (`npm:dev`) is outside the grammar.
  if (!args.length || args.some((arg) => !/\s/.test(arg)))
    throw new UnreadScriptError()
  const inner = descend(scope)
  const found = args
    .map((arg) => readLine(arg, env, inner))
    .filter((command) => command !== undefined)
  if (found.length !== 1) throw new UnreadScriptError()
  return found[0]!
}

/** Reads the assignments of a prefix: `PORT=<digits>` sets the port, other names must be safe and literal. @returns The words after the assignments and the `PORT` they set. */
function readAssignments(
  words: string[],
  env: PortEnv,
): { rest: string[]; env: PortEnv } {
  let port = env.port
  let index = 0
  for (; index < words.length; index += 1) {
    const match = ASSIGNMENT.exec(words[index]!)
    if (!match) break
    if (match[1] === 'PORT') port = parsePort(match[2])
    else if (DEVELOPMENT_SCRIPT_UNSAFE_ASSIGNMENT_NAME.test(match[1]!))
      throw new UnreadScriptError()
  }
  return { rest: words.slice(index), env: { port } }
}

/** Reads the prefix of a command: assignments, then optionally `cross-env` or a bare `env` with assignments only. */
function readPrefix(
  words: string[],
  env: PortEnv,
): { program: string[]; env: PortEnv } {
  const first = readAssignments(words, env)
  const wrapped = first.rest[0] === 'cross-env' || first.rest[0] === 'env'
  if (!wrapped) return { program: first.rest, env: first.env }
  const second = readAssignments(first.rest.slice(1), first.env)
  return { program: second.rest, env: second.env }
}

/** Reads the program of a command: `next dev`, a delegation, or `concurrently`. @throws {@link UnreadScriptError} For any other program. */
function readProgram(
  program: string[],
  env: PortEnv,
  scope: LineScope,
): DevelopmentCommand | undefined {
  const args = nextArguments(program, scope.scripts)
  if (args) return readNextDevCommand(args, env, scope)
  if (program[0] === 'concurrently')
    return readConcurrently(program.slice(1), env, scope)
  const name = delegatedScriptName(program)
  if (name === undefined) throw new UnreadScriptError()
  return readDelegation(name, env, scope, program[0] === 'bun')
}

/**
 * Reads one statement. `export PORT=<digits>` sets the exported port for the statements after it; a statement of assignments alone changes nothing a program sees; any other statement is a command with its prefix.
 * @returns The `PORT` after the statement and the `next dev` command it is or delegates to.
 * @throws {@link UnreadScriptError} Carrying the statement's words when it leaves the grammar.
 */
function readStatement(
  words: string[],
  env: PortEnv,
  scope: LineScope,
): { env: PortEnv; command?: DevelopmentCommand } {
  try {
    if (words[0] === 'export') {
      const match = words.length === 2 ? /^PORT=(.*)$/.exec(words[1]!) : null
      if (!match) throw new UnreadScriptError()
      return { env: { port: parsePort(match[1]) } }
    }
    const prefix = readPrefix(words, env)
    if (!prefix.program.length) {
      // Assignments alone are shell variables of this line; a bare `PORT=N` may or may not reach a later program (it does when `PORT` is already exported), so it is outside the grammar.
      if (
        !words.every((word) => ASSIGNMENT.test(word)) ||
        words.some((word) => word.startsWith('PORT='))
      )
        throw new UnreadScriptError()
      return { env }
    }
    return { env, command: readProgram(prefix.program, prefix.env, scope) }
  } catch (error) {
    if (error instanceof UnreadScriptError && !error.words.length)
      throw new UnreadScriptError(words, error.bunEnv)
    throw error
  }
}

/**
 * Reads a script line against the grammar of D72: statements joined by `&&` or `;`, each an allowed assignment, an allowed `next dev`, a delegation without arguments or one `concurrently`; every statement is checked, the first `next dev` decides.
 * @param env - The exported `PORT` the line starts with (set by a delegating command).
 * @returns The first `next dev` command, or `undefined` when the line runs none.
 * @throws {@link UnreadScriptError} When any statement leaves the grammar.
 */
function readLine(
  line: string,
  env: PortEnv,
  scope: LineScope,
): DevelopmentCommand | undefined {
  let current = env
  let first: DevelopmentCommand | undefined
  for (const words of tokenizeDevelopmentScript(line)) {
    const step = readStatement(words, current, scope)
    current = step.env
    first ??= step.command
  }
  return first
}

/** Names the step that gave the port, for the refusal and the run resource. */
function describeSource(found: DevelopmentCommand): string {
  const where = found.delegate
    ? `the "${showScriptName(found.delegate)}" script that the dev script runs in package.json`
    : 'the dev script in package.json'
  return found.via === 'assignment' ? `a PORT assignment in ${where}` : where
}

/** Cuts a text for the source to {@link DEVELOPMENT_SCRIPT_UNREAD_SEGMENT_MAX_CHARS} characters. */
function cutForSource(text: string): string {
  return cutTextToFit(
    text,
    (candidate) =>
      Array.from(candidate).length <=
      DEVELOPMENT_SCRIPT_UNREAD_SEGMENT_MAX_CHARS,
  )
}

/** Says why Next's default was taken when the script is outside the grammar: the quoted structure of the statement that left it (D72 rule 2). */
function describeUnread(segment: string, bunEnv: boolean): string {
  if (bunEnv)
    return `${DEVELOPMENT_BUN_ENV_UNREAD_REASON}: "${cutForSource(segment)}"`
  return `Next's default port, taken because the dev script has a form Codebook does not read: "${cutForSource(segment)}"`
}

/**
 * Reads the `dev` script against the grammar.
 * @returns The command it runs, or the words of the statement that left the grammar.
 */
function readDevScript(
  dev: string,
  scripts: Scripts,
  bun: boolean,
):
  | { command: DevelopmentCommand }
  | { unread: readonly string[]; bunEnv: boolean } {
  try {
    const command = readLine(dev, {}, { scripts, depth: 0, bun })
    // A chain that never runs `next dev` has nothing to read a port from.
    if (!command)
      throw new UnreadScriptError(tokenizeDevelopmentScript(dev).flat())
    return { command }
  } catch (error) {
    if (error instanceof UnreadScriptError)
      return { unread: error.words, bunEnv: error.bunEnv }
    throw error
  }
}

/**
 * Finds the port the project's own `dev` script would start `next dev` on, so the app runs on the origin its auth and callback settings point to.
 *
 * Called during repository-browser preparation by {@link ConfiguredBrowserRun}, before {@link launchDevelopmentServer}.
 * The script is read as text, never run, against a fixed grammar (D72): statements joined by `&&` or `;`, each an assignment (`PORT=4000`, `export PORT=4000`), a `next dev` command (reached by `next`, `npx next`, `bunx next`, `pnpm exec next`, `yarn next` or a `node_modules/.bin/next` path, after `cross-env` or `env` with assignments only, with Next's own `dev` flags and literal values; the last `-p`/`--port` wins), a delegation without arguments (`npm run x`, `pnpm x`, `pnpm run x`, `yarn x`, `yarn run x`, `bun run x`, followed down to {@link DEVELOPMENT_SCRIPT_NESTING_LIMIT} levels) or one `concurrently` whose quoted commands are read by the same grammar. The port is the last `-p`/`--port`, else the `PORT` the script exports or assigns before the command, else Next's default 3000 (the sources D67 names). `.env*` files are not read because Next reads `PORT` before it loads them; but Bun loads them into the environment of the scripts it runs, so a `next dev` without a port flag and without a `PORT` assigned in the script is unread when it is reached by `bun run` or the root holds `bun.lock` or `bun.lockb` (F499).
 * Anything outside the grammar makes the script unread: no port is asserted, Next's default 3000 is returned, and the source quotes the structure of the statement that left the grammar (program and flag names only).
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
  let scripts: Scripts
  try {
    const declared: unknown = JSON.parse(packageText ?? '')?.scripts
    if (declared && typeof declared === 'object')
      scripts = declared as Record<string, unknown>
  } catch {
    // A package.json that is absent or not JSON declares nothing; Next itself will report it.
  }
  const dev = scripts?.dev
  const fallback = { port: DEVELOPMENT_SERVER_DEFAULT_PORT }
  if (typeof dev !== 'string')
    return { ...fallback, source: "Next's default port" }
  const read = readDevScript(dev, scripts, await hasBunLockfile(root))
  if ('unread' in read)
    return {
      ...fallback,
      source: describeUnread(
        showDevelopmentScriptSegment(read.unread, scripts),
        read.bunEnv,
      ),
    }
  if (read.command.port !== undefined)
    return { port: read.command.port, source: describeSource(read.command) }
  return { ...fallback, source: "Next's default port" }
}
