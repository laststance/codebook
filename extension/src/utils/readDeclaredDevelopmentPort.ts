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
  splitShellWords,
  type ShellDialect,
  type ShellWord,
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

/** What a line starts from: the `PORT` of the processes it runs, the shell dialect that reads it, and, for a double-quoted nested line whose `$` the outer shell has already expanded, the `PORT` that shell saw. */
type LineScope = {
  env: PortEnv
  dialect: ShellDialect
  frozenExpansion?: { env: PortEnv }
}

/** What one program runs with: the `PORT` in its environment (an assignment before it counts) and the `PORT` a `${PORT:-N}` in its words expanded against (an assignment in the same command does not count). */
type ProgramEnv = { assigned: PortEnv; expansion: PortEnv }

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
  expansion: PortEnv,
): PortValue {
  if (text === undefined) return {}
  const direct = parsePort(text)
  if (direct !== undefined) return { port: direct }
  const withDefault = /^\$\{PORT:-([^}]*)\}$/.exec(text)
  if (withDefault) {
    if (typeof expansion === 'number') return { port: expansion }
    const fallback =
      expansion === undefined ? parsePort(withDefault[1]) : undefined
    return fallback === undefined ? { unresolved: true } : { port: fallback }
  }
  return text.includes('$') ? { unresolved: true } : {}
}

/** Reads the `-p`/`--port` flag from command words (`-p 1`, `-p=1`, `-p1`, `--port 1`, `--port=1`); quotes are already removed. The last one wins, as in Next's own parser (F452). */
function readPortFlag(words: string[], expansion: PortEnv): PortValue {
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

/** A flag whose next word is a secret: `--token abc`, `--api-key abc`, `--password abc`, `--secret abc`, `--auth abc`, `--credentials abc`, `--cookie abc`, `--bearer abc` (any name that contains one of those words). `-p` is the port, not a password, and stays visible. */
const SECRET_FLAG =
  /^--?[\w.-]*(?:token|key|password|passwd|secret|credential|auth|cookie|bearer)[\w.-]*$/i
/** The names whose assignment is kept as written when its value is a port or a port variable. */
const PORT_ASSIGNMENT_NAMES = new Set(['PORT', '-p', '--port'])
/** A port, or a variable that can only stand for one (`$APP_PORT`, `${PORT:-4000}`). */
const PORT_LIKE_VALUE = /^(?:\d{1,5}|\$\{?\w+(?::-\d+)?\}?)$/
/** The user and password of a URL (`https://user:pw@host`). */
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi

/** Masks one word for the quoted segment: URL credentials, and every value after an `=` (also across line breaks) unless it is a port; `API_KEY=x` reads `API_KEY=…`. */
function maskWord(word: string): string {
  const withoutCredentials = word.replace(URL_CREDENTIALS, '$1…@')
  const equals = withoutCredentials.indexOf('=')
  if (equals < 0) return withoutCredentials
  const name = withoutCredentials.slice(0, equals)
  const value = withoutCredentials.slice(equals + 1)
  return PORT_ASSIGNMENT_NAMES.has(name) && PORT_LIKE_VALUE.test(value)
    ? withoutCredentials
    : `${name}=…`
}

/** Words a text of the script for the run resource, as a cause is worded: terminal controls stripped, the home directory and the workspace root replaced ({@link sanitizeCause}). */
function showText(reader: Reader, text: string): string {
  return sanitizeCause(stripTerminalControls(text), reader.roots)
}

/** Remembers the first command the reader could not interpret, for the source text: secrets are masked (every `=` value, URL credentials, the value after a secret-looking flag), private paths replaced, control characters stripped, and the text cut (F464). */
function noteUnread(reader: Reader, words: string[]): void {
  if (reader.unread !== undefined) return
  const shown = words.map((word, index) => {
    const previous = words[index - 1]
    const secret =
      previous !== undefined &&
      !previous.includes('=') &&
      SECRET_FLAG.test(previous)
    return showText(reader, secret ? '…' : maskWord(word))
  })
  reader.unread = cutTextToFit(
    shown.join(' '),
    (candidate) =>
      Array.from(candidate).length <=
      DEVELOPMENT_SCRIPT_UNREAD_SEGMENT_MAX_CHARS,
  )
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

/** What a `dotenv`-style wrapper's options give: a `PORT` set with `-v PORT=N`, whether that value is a variable the reader cannot resolve, and the env files it loads (`.env` when none is named). */
type DotenvOptions = { port?: number; unresolved: boolean; envFiles: string[] }

/** Where the prefix scan goes after a wrapper form: the next word's index, the wrapper whose flags are skipped from there, and what a `dotenv` wrapper's options said. */
type WrapperStep = {
  next: number
  wrapper: string | undefined
  dotenv?: DotenvOptions
}

/**
 * Reads the options between a `dotenv`-style runner and its `--`: `-v NAME=value` and `--variable NAME=value` (dotenv-cli), `--env NAME=value` (dotenvx), and the env files of `-e`, `-f` and `--env-file` (`-e` names a file for dotenv-cli and a `NAME=value` for dotenvx).
 * Called by {@link readWrapperStep}; a runner that names no file loads `.env`.
 */
function readDotenvOptions(
  options: string[],
  expansion: PortEnv,
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
  expansion: PortEnv,
): WrapperStep | undefined {
  const word = words[index]!
  const name = programName(word)
  const following = words[index + 1]
  // A flag of a wrapper (`npx -y`, `env -u X`, `npm exec --`) is not the program; some take a value.
  if (wrapper !== undefined && word.startsWith('-')) {
    const skipsValue = wrapper === 'env' && ENV_FLAGS_WITH_VALUE.has(word)
    return { next: index + (skipsValue ? 2 : 1), wrapper }
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
  port?: number
  unresolved: boolean
  exported: boolean
  /** The env files a `dotenv`-style wrapper loads (F462). */
  envFiles: string[]
  /** Where the program starts in the words. */
  programStart: number
}

/**
 * Separates a command's leading `NAME=value` words and wrappers from the program that runs.
 * @param expansion - The `PORT` a `${PORT:-N}` in the prefix expands against.
 * @returns The `PORT` assigned before the program (if any, also by `dotenv -v PORT=N`), whether a `PORT=` value was a variable the reader cannot resolve, whether the words were an `export`/`set` statement (`set` in any case, as on Windows), the env files a `dotenv` wrapper loads, and where the program starts.
 */
function splitCommandPrefix(
  words: string[],
  scripts: Record<string, unknown> | undefined,
  expansion: PortEnv,
): CommandPrefix {
  let port: number | undefined
  let unresolved = false
  let exported = false
  const envFiles: string[] = []
  let wrapper: string | undefined
  let index = 0
  while (index < words.length) {
    const word = words[index]!
    if (word === 'export' || word.toLowerCase() === 'set') {
      exported = true
      wrapper = undefined
      index += 1
    } else if (/^\w+=/.test(word)) {
      const assigned = /^PORT=/.test(word)
        ? readPortValue(word.slice(5), expansion)
        : {}
      port = assigned.port ?? port
      unresolved ||= assigned.unresolved === true
      index += 1
    } else {
      const step = readWrapperStep(words, index, wrapper, scripts, expansion)
      if (!step) break
      if (step.dotenv) {
        port = step.dotenv.port ?? port
        unresolved ||= step.dotenv.unresolved
        envFiles.push(...step.dotenv.envFiles)
      }
      index = step.next
      wrapper = step.wrapper
    }
  }
  return { port, unresolved, exported, envFiles, programStart: index }
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
  expansion: PortEnv,
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

/**
 * Finds the `next dev` command in one script and the port it would use, as the shell would run it.
 * The first command that is `next dev` (or delegates to a script that runs it) decides; a command the reader cannot interpret is remembered in the reader and skipped.
 * @param scope - The `PORT` the outer line gave this one (`PORT=4000 sh -c "next dev"`), its shell dialect, and the `PORT` an outer shell expanded a double-quoted line against.
 */
function readCommandLine(
  line: string,
  reader: Reader,
  depth: number,
  scope: LineScope,
): DevelopmentCommand | undefined {
  // The `PORT` the shell holds after the commands so far (an `export`, a `set`, or an outer assignment).
  let env = scope.env
  for (const detailed of splitShellWords(line, scope.dialect)) {
    const words = detailed.map((word) => word.text)
    // `setx` writes the user's stored environment, not the current shell's, so the port is not decided here.
    if (programName(words[0] ?? '') === 'setx') {
      noteUnread(reader, words)
      continue
    }
    // A subshell, a group or a command substitution is never interpreted.
    if (hasUnreadableSyntax(words)) {
      noteUnread(reader, words)
      continue
    }
    const expansion = scope.frozenExpansion ? scope.frozenExpansion.env : env
    const prefix = splitCommandPrefix(words, reader.scripts, expansion)
    if (prefix.unresolved) noteUnread(reader, words)
    if (prefix.exported) {
      env = prefix.port ?? (prefix.unresolved ? 'unknown' : env)
      continue
    }
    const found = readProgram(
      detailed.slice(prefix.programStart),
      {
        assigned: prefix.port ?? (prefix.unresolved ? 'unknown' : env),
        expansion,
      },
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
    if (mentionsNext(words.slice(prefix.programStart)))
      noteUnread(reader, words)
  }
  return undefined
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
  if (nested !== undefined)
    return mayDescend(reader, depth, words)
      ? readCommandLine(nested.text, reader, depth + 1, {
          env: run.assigned,
          dialect: nested.dialect,
          // A double-quoted line was expanded by the shell around it, before the assignment of this command (F463).
          frozenExpansion: nested.expandedByOuterShell
            ? { env: run.expansion }
            : undefined,
        })
      : undefined
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

/** Says why Next's default was taken: a form the reader does not read (quoted, masked), and an env file a `dotenv` wrapper loads, whose `PORT` Codebook does not read (F462). */
function describeDefault(reader: Reader): string {
  const reasons: string[] = []
  if (reader.envFiles !== undefined)
    reasons.push(
      `the port may come from ${reader.envFiles.map((file) => `"${showText(reader, file)}"`).join(', ')}, which a dotenv wrapper in the dev script loads and Codebook does not read`,
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
