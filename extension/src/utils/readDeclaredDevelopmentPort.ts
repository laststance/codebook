import { access, open } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import {
  DEVELOPMENT_BUN_ENV_UNREAD_REASON,
  DEVELOPMENT_BUN_LOCKFILE_SEARCH_MAX_FOLDERS,
  DEVELOPMENT_BUN_LOCKFILES,
  DEVELOPMENT_BUN_PACKAGE_MANAGER_PREFIX,
  DEVELOPMENT_BUN_SHELL_UNREAD_REASON,
  DEVELOPMENT_CMD_UNREAD_REASON,
  DEVELOPMENT_EMPTY_SCRIPT_SOURCE,
  DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES,
  DEVELOPMENT_SCRIPT_NESTING_LIMIT,
  DEVELOPMENT_SCRIPT_PLAIN_DELEGATION_NAMES,
  DEVELOPMENT_SCRIPT_UNREAD_SEGMENT_MAX_CHARS,
  DEVELOPMENT_SCRIPT_UNSAFE_ASSIGNMENT_NAME,
  DEVELOPMENT_SCRIPT_VALUELESS_NEXT_FLAGS,
  DEVELOPMENT_SERVER_DEFAULT_PORT,
  DEVELOPMENT_SERVER_MAX_PORT,
  DEVELOPMENT_YARN_BERRY_CONFIG,
  DEVELOPMENT_YARN_BERRY_MIN_MAJOR,
  DEVELOPMENT_YARN_SHELL_UNREAD_REASON,
} from '../constants'

import { cutTextToFit } from './cutTextToFit'
import {
  showDevelopmentScriptSegment,
  showScriptName,
} from './showDevelopmentScriptSegment'
import {
  tokenizeDevelopmentScript,
  UnreadScriptError,
  type UnreadReason,
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

/** Whether a folder holds the named file or folder; only existence is checked. */
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

/**
 * The folders a project-level marker is searched in: the opened folder and the folders above it up to the Git root (the first folder that holds `.git`, a folder or a file), at most {@link DEVELOPMENT_BUN_LOCKFILE_SEARCH_MAX_FOLDERS} folders counted from the opened one; without a Git root in that range only the opened folder (F514).
 *
 * Called by {@link readDeclaredDevelopmentPort} once per read, for {@link isBunProject} and {@link isYarnBerryProject}.
 *
 * @param root - The opened folder; resolved to an absolute path, so a relative root climbs the real folders above it.
 * @returns The folders to search, the opened one first; one folder when no Git root is in range.
 *
 * @example
 * ```ts
 * await projectMarkerFolders('/repo/apps/web') // ['/repo/apps/web', '/repo/apps', '/repo'] when /repo holds .git
 * ```
 */
async function projectMarkerFolders(root: string): Promise<string[]> {
  const folders: string[] = []
  let folder = resolve(root)
  for (
    let climbed = 0;
    climbed < DEVELOPMENT_BUN_LOCKFILE_SEARCH_MAX_FOLDERS;
    climbed += 1
  ) {
    folders.push(folder)
    // The Git root ends the climb and is included.
    if (await exists(join(folder, '.git'))) return folders
    const parent = dirname(folder)
    if (parent === folder) break
    folder = parent
  }
  // No Git root in range: only the opened folder counts.
  return [folders[0]!]
}

/** Whether any of the folders holds any of the named files; only existence is checked. */
async function anyFolderHolds(
  folders: readonly string[],
  names: readonly string[],
): Promise<boolean> {
  for (const folder of folders)
    for (const name of names) if (await exists(join(folder, name))) return true
  return false
}

/**
 * Whether the project is a Bun project: a Bun lockfile in {@link projectMarkerFolders}, or a `packageManager` of the opened `package.json` that starts with {@link DEVELOPMENT_BUN_PACKAGE_MANAGER_PREFIX} (F514). Only existence is checked for lockfiles; no content is read (F499).
 *
 * Called by {@link readDeclaredDevelopmentPort} once per read.
 *
 * @param folders - The folders from {@link projectMarkerFolders}.
 * @param packageManager - The `packageManager` field of that `package.json`, if any.
 *
 * @example
 * ```ts
 * await isBunProject(['/repo'], undefined) // true when /repo holds bun.lock
 * await isBunProject(['/repo'], 'bun@1.2.0') // true
 * ```
 */
async function isBunProject(
  folders: readonly string[],
  packageManager: unknown,
): Promise<boolean> {
  if (
    typeof packageManager === 'string' &&
    packageManager.startsWith(DEVELOPMENT_BUN_PACKAGE_MANAGER_PREFIX)
  )
    return true
  return anyFolderHolds(folders, DEVELOPMENT_BUN_LOCKFILES)
}

/**
 * Whether the project is a Yarn Berry (Yarn 2 and later) project: a `packageManager` of `yarn@` with a major of {@link DEVELOPMENT_YARN_BERRY_MIN_MAJOR} or more, or, when the `package.json` names no package manager, a `.yarnrc.yml` in {@link projectMarkerFolders} (F515). A `packageManager` that names Yarn 1 or another manager wins over a stray `.yarnrc.yml` (F520). Berry runs scripts in its own portable shell, which has no `export` and rejects a `;;` and a `;` followed by blanks at the end of the line, on every platform.
 *
 * Called by {@link readDeclaredDevelopmentPort} once per read.
 *
 * @param folders - The folders from {@link projectMarkerFolders}.
 * @param packageManager - The `packageManager` field of the opened `package.json`, if any.
 *
 * @example
 * ```ts
 * await isYarnBerryProject(['/repo'], 'yarn@4.5.0') // true
 * await isYarnBerryProject(['/repo'], 'yarn@1.22.22') // false, even with /repo/.yarnrc.yml
 * ```
 */
async function isYarnBerryProject(
  folders: readonly string[],
  packageManager: unknown,
): Promise<boolean> {
  // A declared package manager decides; the `.yarnrc.yml` only counts when none is declared (F520).
  if (typeof packageManager === 'string') {
    const major = /^yarn@(\d+)/.exec(packageManager)?.[1]
    return (
      major !== undefined && Number(major) >= DEVELOPMENT_YARN_BERRY_MIN_MAJOR
    )
  }
  return anyFolderHolds(folders, [DEVELOPMENT_YARN_BERRY_CONFIG])
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
  scope: LineScope,
): string[] | undefined {
  const { scripts } = scope
  const [first, second, third] = program
  if (NEXT_PROGRAM.test(first ?? '')) {
    // `cmd` cannot run a program written as a relative path with `/`; only bare `next` is read there (F513).
    if (scope.windows && first!.includes('/'))
      throw new UnreadScriptError([], 'cmd')
    return program.slice(1)
  }
  // `npx` and `bunx` take a package name, not a path: `npx node_modules/.bin/next` fails (F516).
  if ((first === 'npx' || first === 'bunx') && second === 'next')
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
  if (scope.bun) throw new UnreadScriptError([], 'bun-env')
  return {}
}

/** The script a delegation without arguments names: `npm run x`, `pnpm run x`, `yarn run x`, `bun run x`, and `pnpm x` or `yarn x` only for a name in {@link DEVELOPMENT_SCRIPT_PLAIN_DELEGATION_NAMES} or containing `:` (D76, F510); `undefined` for any other program. */
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
    (DEVELOPMENT_SCRIPT_PLAIN_DELEGATION_NAMES.has(first) ||
      first.includes(':'))
  return bare ? first : undefined
}

/** What one line is read with: the project's scripts, how deep the reader already is, and whether Bun runs it (a Bun project, or a script reached by `bun run`), so that its `.env` files may set `PORT` (F499). */
type LineScope = {
  scripts: Scripts
  depth: number
  bun: boolean
  /** Whether `cmd` runs this line's script (the platform is `win32` and the program that runs it is not Yarn Berry). */
  windows: boolean
  /** Whether Yarn Berry's portable shell runs this line's script. */
  yarnBerry: boolean
  /** Whether the platform is `win32`, whatever shell the current step uses. */
  win32: boolean
  /** Whether the project is a Yarn Berry project: only scripts that Yarn runs use its shell (F524). */
  berryProject: boolean
}

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
  manager: string,
): DevelopmentCommand | undefined {
  const script = Object.hasOwn(scope.scripts ?? {}, name)
    ? scope.scripts?.[name]
    : undefined
  if (typeof script !== 'string') throw new UnreadScriptError()
  // A script reached by `bun run` runs with Bun's `.env` loading, whatever starts it further down (F499).
  // The shell is the one of the program that runs the script: Berry's for `yarn` in a Berry project, `cmd` or `sh` for `npm` and `pnpm` (F524).
  const berry = scope.berryProject && manager === 'yarn'
  const inner = readLine(script, env, {
    ...descend(scope),
    bun: scope.bun || manager === 'bun',
    windows: scope.win32 && !berry,
    yarnBerry: berry,
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
  // `concurrently` runs each quoted command in the platform shell, not in the shell that started it (F524).
  const inner = {
    ...descend(scope),
    windows: scope.win32,
    yarnBerry: false,
  }
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
  windows: boolean,
): { rest: string[]; env: PortEnv } {
  let port = env.port
  let index = 0
  for (; index < words.length; index += 1) {
    const match = ASSIGNMENT.exec(words[index]!)
    if (!match) break
    // Windows environment names ignore case, so `port=4000` likely sets `PORT` there; `cmd` meaning is not modeled (F512).
    if (windows && match[1] !== 'PORT' && /^port$/i.test(match[1]!))
      throw new UnreadScriptError([], 'cmd')
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
  scope: LineScope,
): { program: string[]; env: PortEnv } {
  const first = readAssignments(words, env, scope.windows)
  // Under `cmd` a leading `NAME=value` and `env` are commands, not a prefix (F502, D74); `cross-env` parses its own arguments and stays read.
  if (
    scope.windows &&
    (first.rest.length < words.length || first.rest[0] === 'env')
  )
    throw new UnreadScriptError([], 'cmd')
  const wrapped = first.rest[0] === 'cross-env' || first.rest[0] === 'env'
  if (!wrapped) return { program: first.rest, env: first.env }
  const second = readAssignments(first.rest.slice(1), first.env, scope.windows)
  return { program: second.rest, env: second.env }
}

/** Reads the program of a command: `next dev`, a delegation, or `concurrently`. @throws {@link UnreadScriptError} For any other program. */
function readProgram(
  program: string[],
  env: PortEnv,
  scope: LineScope,
): DevelopmentCommand | undefined {
  const args = nextArguments(program, scope)
  if (args) return readNextDevCommand(args, env, scope)
  if (program[0] === 'concurrently')
    return readConcurrently(program.slice(1), env, scope)
  const name = delegatedScriptName(program)
  if (name === undefined) throw new UnreadScriptError()
  // On Windows `bun run` uses Bun Shell, or `cmd` with `run.shell = "system"`; the text means different things (D75).
  if (scope.win32 && program[0] === 'bun')
    throw new UnreadScriptError([], 'bun-shell')
  return readDelegation(name, env, scope, program[0]!)
}

/**
 * Reads `export PORT=<digits>`: the one `export` the grammar accepts.
 *
 * Called by {@link readStatement} for a statement that starts with `export`.
 *
 * @param words - The words of the statement, `export` first.
 * @param scope - The line's scope; its shell decides whether `export` exists.
 * @returns The exported `PORT` the statements after it run with.
 * @throws {@link UnreadScriptError} For any other `export`, and for `export` where the script's shell has none: `cmd` on Windows (F502, D74) and Yarn 2+'s portable shell (D75, F515).
 *
 * @example
 * ```ts
 * readExport(['export', 'PORT=4000'], scope) // { port: 4000 } under sh
 * ```
 */
function readExport(words: string[], scope: LineScope): PortEnv {
  if (scope.windows) throw new UnreadScriptError([], 'cmd')
  if (scope.yarnBerry) throw new UnreadScriptError([], 'yarn-shell')
  const match = words.length === 2 ? /^PORT=(.*)$/.exec(words[1]!) : null
  if (!match) throw new UnreadScriptError()
  return { port: parsePort(match[1]) }
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
    if (words[0] === 'export') return { env: readExport(words, scope) }
    const prefix = readPrefix(words, env, scope)
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
      throw new UnreadScriptError(words, error.reason)
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
  for (const words of tokenizeDevelopmentScript(
    line,
    scope.windows,
    scope.yarnBerry,
  )) {
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
function describeUnread(
  segment: string,
  reason: UnreadReason | undefined,
): string {
  if (reason === 'bun-env')
    return `${DEVELOPMENT_BUN_ENV_UNREAD_REASON}: "${cutForSource(segment)}"`
  if (reason === 'bun-shell')
    return `${DEVELOPMENT_BUN_SHELL_UNREAD_REASON}: "${cutForSource(segment)}"`
  if (reason === 'yarn-shell')
    return `${DEVELOPMENT_YARN_SHELL_UNREAD_REASON}: "${cutForSource(segment)}"`
  if (reason === 'cmd')
    return `${DEVELOPMENT_CMD_UNREAD_REASON}: "${cutForSource(segment)}"`
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
  win32: boolean,
  yarnBerry: boolean,
):
  | { command: DevelopmentCommand }
  | { unread: readonly string[]; reason?: UnreadReason } {
  // The top line runs in Berry's shell in a Berry project, else in the platform shell (F520, F524).
  const windows = win32 && !yarnBerry
  try {
    // A Bun project runs its scripts with Bun Shell on Windows (or `cmd` by setting), whatever the script says (D75, F514).
    if (win32 && !yarnBerry && bun)
      throw new UnreadScriptError(dev.split(/\s+/).filter(Boolean), 'bun-shell')
    const command = readLine(
      dev,
      {},
      {
        scripts,
        depth: 0,
        bun,
        windows,
        yarnBerry,
        win32,
        berryProject: yarnBerry,
      },
    )
    // A chain that never runs `next dev` has nothing to read a port from.
    if (!command)
      throw new UnreadScriptError(
        tokenizeDevelopmentScript(dev, windows, yarnBerry).flat(),
      )
    return { command }
  } catch (error) {
    if (error instanceof UnreadScriptError)
      return {
        // A statement the tokenizer could not name is quoted as the whole script's words, never as an empty text (F503).
        unread: error.words.length
          ? error.words
          : dev.split(/\s+/).filter(Boolean),
        reason: error.reason,
      }
    throw error
  }
}

/**
 * Finds the port the project's own `dev` script would start `next dev` on, so the app runs on the origin its auth and callback settings point to.
 *
 * Called during repository-browser preparation by {@link ConfiguredBrowserRun}, before {@link launchDevelopmentServer}.
 * The script is read as text, never run, against a fixed grammar (D72): statements joined by `&&` or `;`, each an assignment (`PORT=4000`, `export PORT=4000`), a `next dev` command (reached by `next`, `npx next`, `bunx next`, `pnpm exec next`, `yarn next` or a `node_modules/.bin/next` path, after `cross-env` or `env` with assignments only, with Next's own `dev` flags and literal values; the last `-p`/`--port` wins), a delegation without arguments (`npm run x`, `pnpm run x`, `yarn run x`, `bun run x`, and `pnpm x` or `yarn x` only for the names of {@link DEVELOPMENT_SCRIPT_PLAIN_DELEGATION_NAMES} or a name with `:` (D76), followed down to {@link DEVELOPMENT_SCRIPT_NESTING_LIMIT} levels) or one `concurrently` whose quoted commands are read by the same grammar. The port is the last `-p`/`--port`, else the `PORT` the script exports or assigns before the command, else Next's default 3000 (the sources D67 names). `.env*` files are not read because Next reads `PORT` before it loads them; but Bun loads them into the environment of the scripts it runs, so a `next dev` without a port flag and without a `PORT` assigned in the script is unread when it is reached by `bun run` or the project is a Bun project (a lockfile up to the Git root or `packageManager: bun@`, F514; F499). A Yarn Berry project (`packageManager: yarn@2+` or a `.yarnrc.yml` found the same way) reads `export` forms, a `;;` and a `;` followed by blanks at the end of the line as unread with a note naming Yarn's portable shell (D75, F515, F519); a `packageManager` of `yarn@1` or of another manager wins over a stray `.yarnrc.yml` (F520). `npx` and `bunx` take only the bare package name `next`, not a path (F516).
 * The script is read with the meaning of the shell that runs it (D74): `sh` on macOS and Linux, `cmd` on `win32` (Yarn 2+'s portable shell on every platform for the lines that Yarn runs in a Berry project, F520; `npm run`, `pnpm run` and the quoted commands of `concurrently` keep `cmd` on `win32` and `sh` elsewhere, as each script is read with the shell of the program that runs it, F524), where single quotes, `NAME=value` prefixes, `export`, `env`, `;`, a `port` variable in another case than `PORT` and a program path with `/` are unread with a note naming `cmd`; a Bun project and `bun run` are unread there with a note naming Bun's shell (D75). An empty script is told as empty (F511). One trailing `;` is allowed, and a word with a quote before its `=` is no assignment.
 * Anything outside the grammar makes the script unread: no port is asserted, Next's default 3000 is returned, and the source quotes the structure of the statement that left the grammar (program and flag names only).
 *
 * @param root - The trusted workspace root that holds `package.json`; a relative path is resolved against the current directory first (F517).
 * @param platform - The platform whose shell runs the script: `cmd` on `win32`, `sh` elsewhere (D74); tests set it to read the Windows meaning on any host.
 * @returns The port and a short description of the step that gave it.
 *
 * @example
 * ```ts
 * await readDeclaredDevelopmentPort('/repo') // { port: 3165, source: 'the dev script in package.json' }
 * ```
 */
export async function readDeclaredDevelopmentPort(
  root: string,
  platform: NodeJS.Platform = process.platform,
): Promise<DeclaredDevelopmentPort> {
  const packageText = await readProjectFile(join(root, 'package.json'))
  let scripts: Scripts
  let packageManager: unknown
  try {
    const parsed: unknown = JSON.parse(packageText ?? '')
    const declared = (parsed as { scripts?: unknown } | null)?.scripts
    packageManager = (parsed as { packageManager?: unknown } | null)
      ?.packageManager
    if (declared && typeof declared === 'object')
      scripts = declared as Record<string, unknown>
  } catch {
    // A package.json that is absent or not JSON declares nothing; Next itself will report it.
  }
  const dev = scripts?.dev
  const fallback = { port: DEVELOPMENT_SERVER_DEFAULT_PORT }
  if (typeof dev !== 'string')
    return { ...fallback, source: "Next's default port" }
  // An empty or blank script runs nothing; say so instead of quoting an empty text (F511).
  if (dev.trim() === '')
    return { ...fallback, source: DEVELOPMENT_EMPTY_SCRIPT_SOURCE }
  const folders = await projectMarkerFolders(root)
  const yarnBerry = await isYarnBerryProject(folders, packageManager)
  const read = readDevScript(
    dev,
    scripts,
    await isBunProject(folders, packageManager),
    platform === 'win32',
    yarnBerry,
  )
  if ('unread' in read)
    return {
      ...fallback,
      source: describeUnread(
        showDevelopmentScriptSegment(read.unread, scripts),
        read.reason,
      ),
    }
  if (read.command.port !== undefined)
    return { port: read.command.port, source: describeSource(read.command) }
  return { ...fallback, source: "Next's default port" }
}
