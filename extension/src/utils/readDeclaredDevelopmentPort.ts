import { open } from 'node:fs/promises'
import { join } from 'node:path'

import {
  DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES,
  DEVELOPMENT_SCRIPT_NESTING_LIMIT,
  DEVELOPMENT_SCRIPT_UNREAD_SEGMENT_MAX_CHARS,
  DEVELOPMENT_SERVER_DEFAULT_PORT,
  DEVELOPMENT_SERVER_MAX_PORT,
} from '../constants'

import { causeRootsFor } from './causeRootsFor'
import { cutTextToFit } from './cutTextToFit'
import { sanitizeCause, type CauseRoots } from './sanitizeCause'
import {
  splitShellStatements,
  type ShellDialect,
  type ShellStatement,
  type ShellWord,
  type StatementEnd,
} from './splitShellCommandLine'
import { stripTerminalControls } from './stripTerminalControls'

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

/** One reading of a package.json: its scripts, the private roots a quoted text must not show, the first segment the reader could not interpret (already masked, sanitized, cut and stripped of control characters) and the env files an `dotenv`-style wrapper loads. */
type Reader = {
  scripts: Record<string, unknown> | undefined
  roots: CauseRoots
  unread?: string
  envFiles?: string[]
}

/** What `PORT` is where the reader stands: unset, a known port, or set to a value the reader cannot resolve. It decides what a shell `${PORT:-N}` expands to (F463). */
type PortEnv = number | 'unknown' | undefined

/** What a `${PORT:-N}` expands against: a {@link PortEnv}, or `'literal'` in `cmd /c` text, where nothing is expanded and the text reaches the program as written (F471). */
type Expansion = PortEnv | 'literal'

/** What a line starts from: the `PORT` of the processes it runs, the shell dialect that reads it, and, for a double-quoted nested line whose `$` the outer shell has already expanded, the `PORT` that shell saw. */
type LineScope = {
  env: PortEnv
  dialect: ShellDialect
  frozenExpansion?: { env: Expansion }
}

/** What one program runs with: the `PORT` in its environment (an assignment before it counts) and the `PORT` a `${PORT:-N}` in its words expanded against (an assignment in the same command does not count). */
type ProgramEnv = { assigned: PortEnv; expansion: Expansion }

/** What a port flag or assignment says: a port, or that its value is a variable the reader cannot resolve. */
type PortValue = { port?: number; unresolved?: boolean }

/** Accepts only a whole decimal TCP port; anything else (`$PORT`, `0`, `99999`) is not a declaration. */
function parsePort(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d{1,5}$/.test(text)) return undefined
  const port = Number(text)
  return port >= 1 && port <= DEVELOPMENT_SERVER_MAX_PORT ? port : undefined
}

/**
 * Reads a port value: digits, or a shell `${PORT:-4000}`, which is the `PORT` already set where the shell expands it, else the default; any other `$…` is a variable the reader cannot resolve.
 * @param expansion - The `PORT` the shell expands against: a `PORT` exported or set by an earlier command, or inherited, wins over the default; an assignment in the same command does not count (F463).
 */
function readPortValue(
  text: string | undefined,
  expansion: Expansion,
): PortValue {
  if (text === undefined) return {}
  const direct = parsePort(text)
  if (direct !== undefined) return { port: direct }
  const withDefault = /^\$\{PORT:-([^}]*)\}$/.exec(text)
  if (withDefault) {
    // `cmd` expands no `${…}`: the text reaches the program as written, so it is no port (F471).
    if (expansion === 'literal') return { unresolved: true }
    if (typeof expansion === 'number') return { port: expansion }
    const fallback =
      expansion === undefined ? parsePort(withDefault[1]) : undefined
    return fallback === undefined ? { unresolved: true } : { port: fallback }
  }
  return text.includes('$') ? { unresolved: true } : {}
}

/** Reads the `-p`/`--port` flag from command words (`-p 1`, `-p=1`, `-p1`, `--port 1`, `--port=1`); quotes are already removed. The last one wins, as in Next's own parser (F452). */
function readPortFlag(words: string[], expansion: Expansion): PortValue {
  let last: PortValue = {}
  for (const [index, word] of words.entries()) {
    if (word === '-p' || word === '--port') {
      last = readPortValue(words[index + 1], expansion)
      continue
    }
    const attached = /^(?:-p=?|--port=)(\d+|\$.*)$/.exec(word)
    if (attached) last = readPortValue(attached[1], expansion)
  }
  return last
}

/** The name of a program as the shell finds it: no folders (either separator), no Windows launcher extension (`.cmd`, `.exe`, `.bat`, `.ps1`), lower case, so `node_modules\.bin\Next.CMD` is `next`. */
function programName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? '')
    .replace(/\.(?:cmd|exe|bat|ps1)$/i, '')
    .toLowerCase()
}

/** Words a text of the script for the run resource, as a cause is worded: terminal controls stripped, the home directory and the workspace root replaced ({@link sanitizeCause}). */
function showText(reader: Reader, text: string): string {
  return sanitizeCause(stripTerminalControls(text), reader.roots)
}

/** Remembers the first command the reader could not interpret, for the source text: only its structure is kept, the program and flag names (D71 rule 2); see {@link showStructure}. */
function noteUnread(reader: Reader, words: string[]): void {
  if (reader.unread !== undefined) return
  reader.unread = cutForSource(showStructure(reader, words))
}

/**
 * Says whether the reader may step into another command line from this depth; when not, the segment is remembered as unread.
 * Every step (a quoted command, a delegated script, a `concurrently npm:x` reference) grows the same depth, so cycles and deep chains stop at {@link DEVELOPMENT_SCRIPT_NESTING_LIMIT} (F458).
 */
function mayDescend(reader: Reader, depth: number, words: string[]): boolean {
  if (depth < DEVELOPMENT_SCRIPT_NESTING_LIMIT) return true
  noteUnread(reader, words)
  return false
}

/** Whether the words use a shell form the reader never interprets: a subshell, a group, a command substitution. */
function hasUnreadableSyntax(words: string[]): boolean {
  return words.some(
    (word) =>
      word === '(' ||
      word === ')' ||
      word === '{' ||
      word === '}' ||
      word.includes('`'),
  )
}

/** Whether the words run `next` (as `next`, `next dev` or `next -…`) in a way the reader did not recognize, such as behind an unknown wrapper. */
function mentionsNext(words: string[]): boolean {
  return words.some(
    (word, index) =>
      programName(word) === 'next' &&
      words[index - 1] !== 'run' &&
      (words[index + 1] === undefined ||
        words[index + 1] === 'dev' ||
        words[index + 1]!.startsWith('-')),
  )
}

/** The runners that execute the command after them, whose own flags are skipped: `cross-env A=1 cmd`, `env A=1 cmd`, `npx cmd`, `bunx cmd`. */
const COMMAND_WRAPPERS = new Set(['cross-env', 'env', 'npx', 'bunx'])
/** The package managers that run a binary or a script, so `pnpm exec next` and `pnpm next` reach `next`. */
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
/** The runners that load env files and then run the command after `--`. */
const DOTENV_RUNNERS = new Set(['dotenv', 'dotenvx', 'dotenv-cli'])
/** The shells whose `-c` flag takes a command line. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
/** The flags of `env` that take a value as the next word. */
const ENV_FLAGS_WITH_VALUE = new Set(['-u', '--unset', '-C', '--chdir'])
/** The flags of `node` that take a value as the next word, before the script path. */
const NODE_FLAGS_WITH_VALUE = new Set([
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '-e',
  '--eval',
  '-p',
  '--print',
  '--conditions',
  '-C',
])
/** The programs and subcommands the reader models; with a script's own names, the only words besides the first program, the flags and the assignment names that the quoted segment shows. */
const SHOWN_WORDS = new Set([
  ...COMMAND_WRAPPERS,
  ...PACKAGE_MANAGERS,
  ...DOTENV_RUNNERS,
  ...SHELLS,
  'cross-env-shell',
  'cmd',
  'concurrently',
  'node',
  'next',
  'dev',
  'run',
  'run-script',
  'exec',
  'export',
  'unset',
  'set',
  'setx',
])
/** Words that open or close a group or a subshell. */
const GROUP_WORDS = new Set(['(', ')', '{', '}'])
/** A word made only of characters that cannot carry a credential: a program name or path (not `name:secret@host`, not `a b`, not `x=y`). */
const PLAIN_WORD = /^@?[\w.\\/+~-]+$/
/** A `npm:dev:web`-style reference to a script. */
const SCRIPT_REFERENCE = /^(?:npm|pnpm|yarn|bun):[\w:.*-]+$/
/** The words of a flag name: `--api-key`, `--port`. */
const LONG_FLAG_NAME = /^--[\w.-]*/

/**
 * Shows a flag as its name only: `--port=4000` is `--port=…`, `-pSECRET` is `-p…`, `-Hname:value` is `-H…`; a bare `-p` or `--token` stays (D71 rule 2).
 * @param word - A word that starts with `-`.
 * @returns The flag with everything after its name replaced by `…`.
 */
function showFlag(word: string): string {
  if (word === '-' || word === '--') return word
  if (!word.startsWith('--'))
    return word.length === 2 ? word : `${word.slice(0, 2)}…`
  const name = LONG_FLAG_NAME.exec(word)![0]
  if (word.length === name.length) return name
  return `${name}${word[name.length] === '=' ? '=' : ''}…`
}

/**
 * Shows one word of an unread segment: flag names, assignment names (`API_KEY=…`), the first program, the modeled programs and the script names stay; every other word (a value, an operand, a token, a URL with credentials) is `…` (D71 rule 2).
 * @param isProgram - Whether the word is the first program of the segment, shown when it is a plain name or path.
 */
function showStructureWord(
  reader: Reader,
  word: string,
  isProgram: boolean,
): string {
  const assignment = /^([\w.-]+)=/.exec(word)
  if (assignment) return `${assignment[1]}=…`
  if (word.startsWith('-')) return showFlag(word)
  if (/^\/[a-z]$/i.test(word) || GROUP_WORDS.has(word)) return word
  const known =
    (PLAIN_WORD.test(word) &&
      (isProgram || SHOWN_WORDS.has(programName(word)))) ||
    SCRIPT_REFERENCE.test(word) ||
    Object.hasOwn(reader.scripts ?? {}, word)
  return known ? showText(reader, word) : '…'
}

/** Shows the words of an unread segment by their structure only (D71 rule 2): the program and flag names, never a value; see {@link showStructureWord}. */
function showStructure(reader: Reader, words: string[]): string {
  const first = words.findIndex(
    (word) => !/^[\w.-]+=/.test(word) && !GROUP_WORDS.has(word),
  )
  return words
    .map((word, index) => showStructureWord(reader, word, index === first))
    .join(' ')
}

/** Shows an env file by its sanitized base name only: no folder, no credentials of a URL. */
function showFileName(reader: Reader, file: string): string {
  const base = file.split(/[\\/]/).pop() ?? ''
  return showText(reader, base.slice(base.lastIndexOf('@') + 1))
}

/** What a `dotenv`-style wrapper's options give: a `PORT` set with `-v PORT=N`, whether that value is a variable the reader cannot resolve, and the env files it loads (`.env` when none is named). */
type DotenvOptions = { port?: number; unresolved: boolean; envFiles: string[] }

/** Where the prefix scan goes after a wrapper form: the next word's index, the wrapper whose flags are skipped from there, and what a `dotenv` wrapper's options said. */
type WrapperStep = {
  next: number
  wrapper: string | undefined
  dotenv?: DotenvOptions
  /** Whether the step is an `env` option that leaves the program without the inherited `PORT` (D71). */
  scrubsPort?: boolean
}

/** Whether an `env` option removes the inherited environment or `PORT`: `-i`, `-` (also inside a cluster such as `-iS`), `--ignore-environment`, `-u PORT`, `-uPORT`, `--unset PORT`, `--unset=PORT`. */
function scrubsInheritedPort(word: string, following: string | undefined) {
  if (word === '-' || word === '--ignore-environment') return true
  if (/^-[A-Za-z]*i[A-Za-z]*$/.test(word)) return true
  if (word === '-u' || word === '--unset') return following === 'PORT'
  return word === '-uPORT' || word === '--unset=PORT'
}

/**
 * Reads the options between a `dotenv`-style runner and its `--`: `-v NAME=value` and `--variable NAME=value` (dotenv-cli), `--env NAME=value` (dotenvx), and the env files of `-e`, `-f` and `--env-file` (`-e` names a file for dotenv-cli and a `NAME=value` for dotenvx).
 * Called by {@link readWrapperStep}; a runner that names no file loads `.env`.
 */
function readDotenvOptions(
  options: string[],
  expansion: Expansion,
): DotenvOptions {
  const result: DotenvOptions = { unresolved: false, envFiles: [] }
  const take = (flag: string, value: string | undefined): void => {
    if (value === undefined) return
    const isVariable =
      flag === '-v' ||
      flag === '--variable' ||
      ((flag === '-e' || flag === '--env') && value.includes('='))
    if (!isVariable) {
      result.envFiles.push(value)
      return
    }
    // The last PORT wins; other variables are not the port.
    if (!value.startsWith('PORT=')) return
    const assigned = readPortValue(value.slice(5), expansion)
    result.port = assigned.port
    result.unresolved = assigned.unresolved === true
  }
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]!
    if (
      ['-e', '--env', '-f', '--env-file', '-v', '--variable'].includes(option)
    ) {
      take(option, options[index + 1])
      index += 1
      continue
    }
    const attached = /^(--env-file|--env|--variable)=([\s\S]*)$/.exec(option)
    if (attached) take(attached[1]!, attached[2])
  }
  if (result.envFiles.length === 0) result.envFiles.push('.env')
  return result
}

/**
 * Reads one word of a command's prefix as a wrapper form: a flag of the wrapper before it, a runner (`cross-env`, `env`, `npx`, `bunx`), `pnpm exec`, `pnpm next` (the binary, when no script is named next) or `dotenv … --`.
 * @returns The step past it, or `undefined` when the word starts the program.
 */
function readWrapperStep(
  words: string[],
  index: number,
  wrapper: string | undefined,
  scripts: Record<string, unknown> | undefined,
  expansion: Expansion,
): WrapperStep | undefined {
  const word = words[index]!
  const name = programName(word)
  const following = words[index + 1]
  // A flag of a wrapper (`npx -y`, `env -u X`, `npm exec --`) is not the program; some take a value.
  if (wrapper !== undefined && word.startsWith('-')) {
    const skipsValue = wrapper === 'env' && ENV_FLAGS_WITH_VALUE.has(word)
    return {
      next: index + (skipsValue ? 2 : 1),
      wrapper,
      scrubsPort: wrapper === 'env' && scrubsInheritedPort(word, following),
    }
  }
  if (COMMAND_WRAPPERS.has(name)) return { next: index + 1, wrapper: name }
  if (PACKAGE_MANAGERS.has(name) && following === 'exec')
    return { next: index + 2, wrapper: 'npx' }
  // `pnpm next dev`, `yarn next dev` and `bun next dev` run the binary when no script is named next.
  if (
    PACKAGE_MANAGERS.has(name) &&
    name !== 'npm' &&
    following === 'next' &&
    typeof scripts?.next !== 'string'
  )
    return { next: index + 1, wrapper: undefined }
  if (DOTENV_RUNNERS.has(name)) {
    const separator = words.indexOf('--', index)
    return separator < 0
      ? undefined
      : {
          next: separator + 1,
          wrapper: undefined,
          dotenv: readDotenvOptions(
            words.slice(index + 1, separator),
            expansion,
          ),
        }
  }
  return undefined
}

/** What {@link splitCommandPrefix} found before the program. */
type CommandPrefix = {
  /** Whether the prefix assigned `PORT`; the last assignment wins and replaces the earlier value and its resolved state (F470). */
  portSet: boolean
  /** What the last assignment gave: a port, `'unknown'` for a value the reader cannot resolve, `undefined` for an empty value or an `unset`. */
  portValue: PortEnv
  unresolved: boolean
  /** Whether a bare `export PORT` hands the shell's own `PORT` to the programs that follow (F470). */
  exportsShellPort: boolean
  exported: boolean
  /** The env files a `dotenv`-style wrapper loads (F462). */
  envFiles: string[]
  /** Where the program starts in the words. */
  programStart: number
}

/** Records an assignment of `PORT` in the prefix: it replaces the earlier value and its resolved state (F470). */
function assignPort(prefix: CommandPrefix, value: PortEnv): void {
  prefix.portSet = true
  prefix.portValue = value
  prefix.unresolved = value === 'unknown'
}

/** Folds a `NAME=value` word of the prefix into what was found: only a `PORT=` matters. An empty value leaves `PORT` unset for Next; a value that is no port and no variable is not one the reader can resolve (F470). */
function absorbAssignment(
  prefix: CommandPrefix,
  word: string,
  expansion: Expansion,
): void {
  if (!/^PORT=/.test(word)) return
  const text = word.slice(5)
  if (text === '') return assignPort(prefix, undefined)
  assignPort(prefix, readPortValue(text, expansion).port ?? 'unknown')
}

/** Folds what a `dotenv`-style wrapper's options gave (its `-v PORT=N` and its env files) into what was found. */
function absorbDotenv(prefix: CommandPrefix, dotenv: DotenvOptions): void {
  if (dotenv.port !== undefined) assignPort(prefix, dotenv.port)
  else if (dotenv.unresolved) assignPort(prefix, 'unknown')
  prefix.envFiles.push(...dotenv.envFiles)
}

/** Whether a word starts a statement that changes the shell's variables instead of running a program: `export`, `unset`, and `set` in any case (as on Windows). */
function isStatementKeyword(word: string): boolean {
  return word === 'export' || word === 'unset' || word.toLowerCase() === 'set'
}

/**
 * Folds the words after `export`, `unset` or `set` into what was found, when every one is understood: `NAME=value` words (`export` and `set`), a sole bare name (`export PORT`, `unset PORT`; another sole name touches nothing). Any other form, a flag (`unset -v`, `export -n`, `set -a`), an extra name (`unset X PORT`, `export X PORT=4000`) or an assignment to `unset`, makes `PORT` unknown (D71 rule 1).
 */
function absorbStatement(
  prefix: CommandPrefix,
  keyword: string,
  args: string[],
  expansion: Expansion,
): void {
  prefix.exported = true
  if (args.length === 0) return
  const isAssignment = (word: string): boolean => /^\w+=/.test(word)
  if (args.every(isAssignment) && keyword.toLowerCase() !== 'unset') {
    for (const word of args) absorbAssignment(prefix, word, expansion)
  } else if (args.length === 1 && /^\w+$/.test(args[0]!)) {
    if (args[0] === 'PORT') absorbBarePort(prefix, keyword)
  } else {
    assignPort(prefix, 'unknown')
  }
}

/** Folds a bare `PORT` after a statement keyword: `unset PORT` removes the variable from the shell and its environment; a bare `export PORT` exports the shell's own value (F470). */
function absorbBarePort(prefix: CommandPrefix, keyword: string): void {
  if (keyword === 'unset') assignPort(prefix, undefined)
  else prefix.exportsShellPort = true
}

/**
 * Separates a command's leading `NAME=value` words and wrappers from the program that runs.
 * @param expansion - The `PORT` a `${PORT:-N}` in the prefix expands against.
 * @returns The `PORT` assigned before the program (if any, also by `dotenv -v PORT=N`), whether a `PORT=` value was a variable the reader cannot resolve, whether the words were an `export`/`set` statement (`set` in any case, as on Windows), the env files a `dotenv` wrapper loads, and where the program starts.
 */
function splitCommandPrefix(
  words: string[],
  scripts: Record<string, unknown> | undefined,
  expansion: Expansion,
): CommandPrefix {
  const prefix: CommandPrefix = {
    portSet: false,
    portValue: undefined,
    unresolved: false,
    exportsShellPort: false,
    exported: false,
    envFiles: [],
    programStart: 0,
  }
  let wrapper: string | undefined
  let index = 0
  while (index < words.length) {
    const word = words[index]!
    if (isStatementKeyword(word)) {
      // The rest of the words belong to the statement; any it does not model makes `PORT` unknown (D71).
      absorbStatement(prefix, word, words.slice(index + 1), expansion)
      index = words.length
    } else if (/^\w+=/.test(word)) {
      absorbAssignment(prefix, word, expansion)
      index += 1
    } else {
      const step = readWrapperStep(words, index, wrapper, scripts, expansion)
      if (!step) break
      if (step.dotenv) absorbDotenv(prefix, step.dotenv)
      if (step.scrubsPort) assignPort(prefix, 'unknown')
      index = step.next
      wrapper = step.wrapper
    }
  }
  prefix.programStart = index
  return prefix
}

/** A command line a wrapper runs, as it reads its quoted argument: the text, the shell dialect that reads it, and whether the shell around it has already expanded its `$` (a double-quoted argument). */
type NestedLine = {
  text: string
  dialect: ShellDialect
  expandedByOuterShell: boolean
}

/** Reads the command line a wrapper runs from its quoted argument: `sh -c '…'`, `bash -c '…'`, `cmd /c "…"` and `cross-env-shell "…"`; `undefined` for any other program. */
function readNestedLine(program: ShellWord[]): NestedLine | undefined {
  const name = programName(program[0]?.text ?? '')
  if (name === 'cross-env-shell')
    return program.length > 1
      ? {
          text: program
            .slice(1)
            .map((word) => word.text)
            .join(' '),
          dialect: 'posix',
          expandedByOuterShell: program.some(
            (word) => word.expandedByOuterShell,
          ),
        }
      : undefined
  if (SHELLS.has(name)) {
    const flag = program.findIndex(
      (word, index) => index > 0 && /^-[a-z]*c[a-z]*$/.test(word.text),
    )
    const line = flag > 0 ? program[flag + 1] : undefined
    return (
      line && {
        text: line.text,
        dialect: 'posix',
        expandedByOuterShell: line.expandedByOuterShell,
      }
    )
  }
  if (name === 'cmd') {
    const flag = program.findIndex(
      (word, index) => index > 0 && /^\/[ck]$/i.test(word.text),
    )
    // `cmd` expands no `${…}`, and `#` and backslashes are ordinary characters in its text (F465).
    return flag > 0
      ? {
          text: program
            .slice(flag + 1)
            .map((word) => word.text)
            .join(' '),
          dialect: 'cmd',
          expandedByOuterShell: false,
        }
      : undefined
  }
  return undefined
}

/** Reads the port of a program that is `next` (also by path, with a launcher extension, or as `node [flags] …/next`); `undefined` for another program or another `next` subcommand such as `build`. */
function readNextProgram(
  program: string[],
  expansion: Expansion,
): PortValue | undefined {
  let args = program
  if (programName(args[0] ?? '') === 'node') {
    let index = 1
    while (index < args.length && args[index]!.startsWith('-'))
      index += NODE_FLAGS_WITH_VALUE.has(args[index]!) ? 2 : 1
    args = args.slice(index)
  }
  if (programName(args[0] ?? '') !== 'next') return undefined
  const rest = args.slice(1)
  // Only `next dev` (or a bare `next`, which is dev) starts the server.
  if (rest[0] && !rest[0].startsWith('-') && rest[0] !== 'dev') return undefined
  return readPortFlag(rest, expansion)
}

/** Reads the package-manager forms that start another script: `npm run x`, `pnpm x`, `pnpm run x`, `yarn x`, `bun dev`, `bun run x`. */
function readDelegation(
  program: string[],
): { name: string; args: string[] } | undefined {
  const manager = programName(program[0] ?? '')
  const [, first, second] = program
  if (!PACKAGE_MANAGERS.has(manager)) return undefined
  const viaRun =
    first === 'run' || (manager === 'npm' && first === 'run-script')
  const bare = manager !== 'npm'
  const name = viaRun ? second : bare ? first : undefined
  if (!name || name.startsWith('-')) return undefined
  return { name, args: program.slice(viaRun ? 3 : 2) }
}

/** The builtins and dot-commands that can set, export or unset a variable in ways the reader does not model (`declare -x PORT=…`, `eval`, `. ./env.sh`, `read PORT`): a statement that starts with one makes `PORT` unknown (D71 rule 1). */
const PORT_TOUCHING_BUILTINS = new Set([
  'declare',
  'typeset',
  'readonly',
  'local',
  'eval',
  'source',
  '.',
  'read',
  'let',
  'getopts',
  'mapfile',
  'readarray',
])

/** Whether a word is a statement keyword or a builtin that can change a variable. */
function isVariableBuiltin(word: string): boolean {
  return isStatementKeyword(word) || PORT_TOUCHING_BUILTINS.has(word)
}

/** Whether the words could change the shell's `PORT` in a way the reader does not follow: a builtin or keyword, `command`/`builtin` in front of one, a word that names `PORT`, or a command substitution. */
function couldTouchPort(words: string[]): boolean {
  return words.some(
    (word) =>
      isVariableBuiltin(word) ||
      word === 'command' ||
      word === 'builtin' ||
      word.includes('PORT') ||
      word.includes('`') ||
      word.includes('$('),
  )
}

/** Where a statement stands in its line: not in the shell's own flow when it is backgrounded or piped, inside a group or subshell, or run only on some paths (`a || export PORT=1`). Such a statement cannot be followed for the `PORT` it sets (D71 rule 1). */
type StatementContext = { uncertain: boolean }

/**
 * Says whether the shell may not run a statement in its own flow, for the `PORT` it sets.
 * @param previous - What ended the statement before.
 * @param statement - The statement; its separator says whether it is backgrounded (`&` in a POSIX shell) or piped (`|`).
 * @param depth - How many groups or subshells are open before the statement.
 */
function contextOf(
  previous: StatementEnd | undefined,
  statement: ShellStatement,
  depth: number,
  dialect: ShellDialect,
): StatementContext {
  const end = statement.endedBy
  const detached =
    end === '|' || previous === '|' || (end === '&' && dialect === 'posix')
  const conditional = previous === '||' || (previous === '&&' && end !== '&&')
  const grouped =
    depth > 0 || statement.words.some((word) => GROUP_WORDS.has(word.text))
  return { uncertain: detached || conditional || grouped }
}

/** How many groups or subshells are open after the words. */
function depthAfter(depth: number, words: string[]): number {
  let open = depth
  for (const word of words) {
    if (word === '{' || word === '(') open += 1
    else if (word === '}' || word === ')') open = Math.max(0, open - 1)
  }
  return open
}

/** Whether the statement is one the reader never interprets: `setx` writes the user's stored environment, not the current shell's, and a subshell, a group or a command substitution is not followed. */
function isUnreadStatement(words: string[]): boolean {
  return programName(words[0] ?? '') === 'setx' || hasUnreadableSyntax(words)
}

/** Reads the prefix of one statement; a `PORT` the reader cannot resolve is told as unread. */
function readStatementPrefix(
  words: string[],
  reader: Reader,
  expansion: Expansion,
): CommandPrefix {
  const prefix = splitCommandPrefix(words, reader.scripts, expansion)
  if (prefix.unresolved) noteUnread(reader, words)
  return prefix
}

/** Whether the program the statement runs changes shell variables in a way the reader does not model: a builtin such as `declare`, or `command export …` and `builtin export …`. */
function runsVariableBuiltin(program: string[]): boolean {
  const name = program[0] ?? ''
  if (name === 'command' || name === 'builtin')
    return program.slice(1).some(isVariableBuiltin)
  return PORT_TOUCHING_BUILTINS.has(name)
}

/** The `PORT` a program runs with: the assignment in front of it (the last one, an empty one unsets), else the shell's exported one. */
function assignedPortOf(prefix: CommandPrefix, env: PortEnv): PortEnv {
  return prefix.portSet ? prefix.portValue : env
}

/** The `PORT` a line holds while it is read: the one exported to the programs it starts, and the shell variable a later `${PORT:-N}` expands (a bare `PORT=5000;` sets only the latter, unless `PORT` is already exported). */
type ShellPorts = { env: PortEnv; shell: PortEnv }

/** The ports after a statement that starts no program (`export PORT=N`, `set PORT=N`, `unset PORT`, a bare `PORT=N`). */
function afterStatement(prefix: CommandPrefix, ports: ShellPorts): ShellPorts {
  if (prefix.exportsShellPort) return { ...ports, env: ports.shell }
  if (!prefix.portSet) return ports
  // A variable that is already in the environment stays exported when it is assigned again.
  const toEnvironment =
    prefix.exported || (ports.env !== undefined && ports.env !== 'unknown')
  return {
    shell: prefix.portValue,
    env: toEnvironment ? prefix.portValue : ports.env,
  }
}

/** What a `${PORT:-N}` in this line expands against: nothing in `cmd` text (F471), the outer shell's `PORT` in a double-quoted nested line, else the shell variable. */
function expansionOf(scope: LineScope, ports: ShellPorts): Expansion {
  if (scope.dialect === 'cmd') return 'literal'
  return scope.frozenExpansion ? scope.frozenExpansion.env : ports.shell
}

/** What the reader knows of `PORT` after an unmodeled statement: nothing. */
const UNKNOWN_PORTS: ShellPorts = { env: 'unknown', shell: 'unknown' }

/** What the loop of {@link readCommandLine} carries from one statement to the next. */
type LineState = {
  ports: ShellPorts
  previous: StatementEnd | undefined
  depth: number
}

/**
 * Applies a statement that starts no program to the `PORT` state; one the reader cannot follow makes it unknown and is told as unread (D71 rule 1).
 * @returns The ports after the statement.
 */
function applyStatement(
  prefix: CommandPrefix,
  words: string[],
  reader: Reader,
  state: LineState,
  context: StatementContext,
): ShellPorts {
  const changes = prefix.portSet || prefix.exportsShellPort
  if (context.uncertain && changes) {
    noteUnread(reader, words)
    return UNKNOWN_PORTS
  }
  return afterStatement(prefix, state.ports)
}

/**
 * Finds the `next dev` command in one script and the port it would use, as the shell would run it.
 * The first command that is `next dev` (or delegates to a script that runs it) decides; a command the reader cannot interpret is remembered in the reader and skipped. A statement that could change `PORT` in a way the reader does not follow makes `PORT` unknown, so no later port is asserted from it (D71).
 * @param scope - The `PORT` the outer line gave this one (`PORT=4000 sh -c "next dev"`), its shell dialect, and the `PORT` an outer shell expanded a double-quoted line against.
 */
function readCommandLine(
  line: string,
  reader: Reader,
  depth: number,
  scope: LineScope,
): DevelopmentCommand | undefined {
  // The `PORT` the shell holds after the commands so far (an `export`, a `set`, a bare assignment, or an outer assignment).
  const state: LineState = {
    ports: { env: scope.env, shell: scope.env },
    previous: undefined,
    depth: 0,
  }
  for (const statement of splitShellStatements(line, scope.dialect)) {
    const words = statement.words.map((word) => word.text)
    const context = contextOf(
      state.previous,
      statement,
      state.depth,
      scope.dialect,
    )
    state.previous = statement.endedBy
    state.depth = depthAfter(state.depth, words)
    const found = readStatement(statement, words, context, reader, depth, {
      scope,
      state,
    })
    if (found) return found
  }
  return undefined
}

/** Reads one statement of a line: updates the `PORT` state, and returns the `next dev` command it is or delegates to. */
function readStatement(
  statement: ShellStatement,
  words: string[],
  context: StatementContext,
  reader: Reader,
  depth: number,
  line: { scope: LineScope; state: LineState },
): DevelopmentCommand | undefined {
  const { scope, state } = line
  const expansion = expansionOf(scope, state.ports)
  if (isUnreadStatement(words)) {
    noteUnread(reader, words)
    if (couldTouchPort(words)) state.ports = UNKNOWN_PORTS
    return undefined
  }
  const prefix = readStatementPrefix(words, reader, expansion)
  // A statement without a program only changes the shell's `PORT`.
  if (prefix.exported || prefix.programStart >= words.length) {
    state.ports = applyStatement(prefix, words, reader, state, context)
    return undefined
  }
  const program = words.slice(prefix.programStart)
  if (runsVariableBuiltin(program)) {
    noteUnread(reader, words)
    state.ports = UNKNOWN_PORTS
    return undefined
  }
  const found = readProgram(
    statement.words.slice(prefix.programStart),
    { assigned: assignedPortOf(prefix, state.ports.env), expansion },
    reader,
    depth,
  )
  if (found) {
    // A wrapper that loads an env file may set the port the reader never sees (F462).
    if (found.port === undefined && prefix.envFiles.length)
      reader.envFiles ??= prefix.envFiles
    return found
  }
  // `next` behind a wrapper the reader does not know is told, not skipped silently.
  if (mentionsNext(program)) noteUnread(reader, words)
  return undefined
}

/** Reads the command line a wrapper runs, one level deeper. */
function readNested(
  nested: NestedLine,
  run: ProgramEnv,
  reader: Reader,
  depth: number,
  words: string[],
): DevelopmentCommand | undefined {
  if (!mayDescend(reader, depth, words)) return undefined
  return readCommandLine(nested.text, reader, depth + 1, {
    env: run.assigned,
    dialect: nested.dialect,
    // A double-quoted line was expanded by the shell around it, before the assignment of this command (F463).
    frozenExpansion: nested.expandedByOuterShell
      ? { env: run.expansion }
      : undefined,
  })
}

/** Reads one program (after its prefix): a quoted command line, `next`, `concurrently`, or a package-manager delegation. */
function readProgram(
  program: ShellWord[],
  run: ProgramEnv,
  reader: Reader,
  depth: number,
): DevelopmentCommand | undefined {
  const words = program.map((word) => word.text)
  const nested = readNestedLine(program)
  if (nested !== undefined) return readNested(nested, run, reader, depth, words)
  const next = readNextProgram(words, run.expansion)
  if (next) {
    if (next.unresolved) noteUnread(reader, words)
    if (next.port !== undefined) return { port: next.port, via: 'flag' }
    return typeof run.assigned === 'number' && !next.unresolved
      ? { port: run.assigned, via: 'assignment' }
      : {}
  }
  if (programName(words[0] ?? '') === 'concurrently')
    return readConcurrently(program, run, reader, depth)
  return readDelegatedScript(words, run, reader, depth)
}

/** Finds the one script a `concurrently npm:<name>` reference names; a wildcard (`npm:dev:*`) must match exactly one script. */
function resolveScriptReference(
  reference: string,
  scripts: Record<string, unknown> | undefined,
): string | undefined {
  const names = Object.keys(scripts ?? {}).filter(
    (name) => typeof scripts?.[name] === 'string',
  )
  if (!reference.includes('*'))
    return names.includes(reference) ? reference : undefined
  const pattern = new RegExp(
    `^${reference
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  )
  const matches = names.filter((name) => pattern.test(name))
  return matches.length === 1 ? matches[0] : undefined
}

/** Reads one argument of `concurrently`: a quoted command line, or an `npm:`/`pnpm:`/`yarn:`/`bun:` script reference; `undefined` when it gives no `next dev` or is a plain argument (a flag, a name). */
function readConcurrentlyArgument(
  argument: ShellWord,
  run: ProgramEnv,
  reader: Reader,
  depth: number,
): DevelopmentCommand | undefined {
  const word = argument.text
  const reference = /^(?:npm|pnpm|yarn|bun):(.+)$/.exec(word)?.[1]
  // A plain argument holds no blank and is no script reference.
  if (reference === undefined && !/\s/.test(word)) return undefined
  if (!mayDescend(reader, depth, [word])) return undefined
  if (reference === undefined)
    return readCommandLine(word, reader, depth + 1, {
      env: run.assigned,
      dialect: 'posix',
      frozenExpansion: argument.expandedByOuterShell
        ? { env: run.expansion }
        : undefined,
    })
  const name = resolveScriptReference(reference, reader.scripts)
  if (name === undefined) {
    noteUnread(reader, [word])
    return undefined
  }
  const found = readCommandLine(
    String(reader.scripts?.[name]),
    reader,
    depth + 1,
    {
      env: run.assigned,
      dialect: 'posix',
    },
  )
  return found && { ...found, delegate: found.delegate ?? name }
}

/** Reads `concurrently`'s arguments in order; the first that gives `next dev` decides. */
function readConcurrently(
  program: ShellWord[],
  run: ProgramEnv,
  reader: Reader,
  depth: number,
): DevelopmentCommand | undefined {
  for (const argument of program.slice(1)) {
    const found = readConcurrentlyArgument(argument, run, reader, depth)
    if (found) return found
  }
  return undefined
}

/** Follows `npm run x` and its kin into script `x`, down to {@link DEVELOPMENT_SCRIPT_NESTING_LIMIT}: arguments after the name win, then the script's own declaration, then the assignment before the delegation. The script runs with the `PORT` of the delegating command, so its `${PORT:-N}` sees an assignment before `npm run`. */
function readDelegatedScript(
  program: string[],
  run: ProgramEnv,
  reader: Reader,
  depth: number,
): DevelopmentCommand | undefined {
  const delegation = reader.scripts ? readDelegation(program) : undefined
  const script = delegation && reader.scripts?.[delegation.name]
  if (!delegation || typeof script !== 'string') return undefined
  if (!mayDescend(reader, depth, program)) return undefined
  const inner = readCommandLine(script, reader, depth + 1, {
    env: run.assigned,
    dialect: 'posix',
  })
  if (!inner) return undefined
  const delegate = inner.delegate ?? delegation.name
  const flag = readPortFlag(delegation.args, run.expansion)
  if (flag.port !== undefined) return { port: flag.port, via: 'flag', delegate }
  return { ...inner, delegate }
}

/** Names the step that gave the port, for the refusal and the run resource. */
function describeSource(found: DevelopmentCommand): string {
  const where = found.delegate
    ? `the "${found.delegate}" script that the dev script runs in package.json`
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

/** Says why Next's default was taken: a form the reader does not read (quoted, masked), and an env file a `dotenv` wrapper loads, whose `PORT` Codebook does not read (F462). */
function describeDefault(reader: Reader): string {
  const reasons: string[] = []
  if (reader.envFiles !== undefined)
    reasons.push(
      `the port may come from ${cutForSource(reader.envFiles.map((file) => `"${showFileName(reader, file)}"`).join(', '))}, which a dotenv wrapper in the dev script loads and Codebook does not read`,
    )
  if (reader.unread !== undefined)
    reasons.push(
      `the dev script has a form Codebook does not read: "${reader.unread}"`,
    )
  return reasons.length === 0
    ? "Next's default port"
    : `Next's default port, taken because ${reasons.join('; and ')}`
}

/**
 * Finds the port the project's own `dev` script would start `next dev` on, so the app runs on the origin its auth and callback settings point to.
 *
 * Called during repository-browser preparation by {@link ConfiguredBrowserRun}, before {@link launchDevelopmentServer}.
 * The order follows what Next does with its command line and environment: the last `-p`/`--port` of the `next dev` command, else a `PORT=` the script itself assigns, else Next's default 3000 (the sources D67 names). `.env*` files are not read because Next reads `PORT` before it loads them.
 * The script is read as a shell command line, never run. Besides a plain `next dev` it reads the forms D68 lists: `cross-env`, `env`, `dotenv … --`, `npx`/`bunx`/`pnpm exec`/`yarn next`, `node [flags] …/next`, `.cmd`/`.exe` names, quoted command lines of `sh -c`, `bash -c`, `cmd /c` and `cross-env-shell`, `${PORT:-N}` defaults, and other scripts reached through `npm run`, `pnpm`, `yarn`, `bun` or `concurrently npm:<script>`, down to {@link DEVELOPMENT_SCRIPT_NESTING_LIMIT} levels.
 * A command the reader cannot interpret (a subshell, an unknown wrapper, a variable) is never guessed: when no port is found, the returned source says Next's default was taken and quotes that command.
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
  const reader: Reader = { scripts: undefined, roots: causeRootsFor([], root) }
  try {
    const declared: unknown = JSON.parse(packageText ?? '')?.scripts
    if (declared && typeof declared === 'object')
      reader.scripts = declared as Record<string, unknown>
  } catch {
    // A package.json that is absent or not JSON declares nothing; Next itself will report it.
  }
  const dev = reader.scripts?.dev
  const found =
    typeof dev === 'string'
      ? readCommandLine(dev, reader, 0, { env: undefined, dialect: 'posix' })
      : undefined
  if (found?.port !== undefined)
    return { port: found.port, source: describeSource(found) }
  return {
    port: DEVELOPMENT_SERVER_DEFAULT_PORT,
    source: describeDefault(reader),
  }
}
