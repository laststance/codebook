import { open } from 'node:fs/promises'
import { join } from 'node:path'

import {
  DEVELOPMENT_PORT_SOURCE_LIMIT_BYTES,
  DEVELOPMENT_SCRIPT_NESTING_LIMIT,
  DEVELOPMENT_SCRIPT_UNREAD_SEGMENT_MAX_CHARS,
  DEVELOPMENT_SERVER_DEFAULT_PORT,
  DEVELOPMENT_SERVER_MAX_PORT,
} from '../constants'

import { cutTextToFit } from './cutTextToFit'
import { splitShellCommandLine } from './splitShellCommandLine'
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

/** One reading of a package.json: its scripts, and the first segment the reader could not interpret (already masked, cut and stripped of control characters). */
type Reader = {
  scripts: Record<string, unknown> | undefined
  unread?: string
}

/** What a port flag or assignment says: a port, or that its value is a variable the reader cannot resolve. */
type PortValue = { port?: number; unresolved?: boolean }

/** Accepts only a whole decimal TCP port; anything else (`$PORT`, `0`, `99999`) is not a declaration. */
function parsePort(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d{1,5}$/.test(text)) return undefined
  const port = Number(text)
  return port >= 1 && port <= DEVELOPMENT_SERVER_MAX_PORT ? port : undefined
}

/** Reads a port value: digits, or the default of a shell `${PORT:-4000}` (the owned process inherits no PORT); any other `$…` is a variable the reader cannot resolve. */
function readPortValue(text: string | undefined): PortValue {
  if (text === undefined) return {}
  const direct = parsePort(text)
  if (direct !== undefined) return { port: direct }
  const fallback = parsePort(/^\$\{PORT:-(\d+)\}$/.exec(text)?.[1])
  if (fallback !== undefined) return { port: fallback }
  return text.includes('$') ? { unresolved: true } : {}
}

/** Reads the `-p`/`--port` flag from command words (`-p 1`, `-p=1`, `-p1`, `--port 1`, `--port=1`); quotes are already removed. The last one wins, as in Next's own parser (F452). */
function readPortFlag(words: string[]): PortValue {
  let last: PortValue = {}
  for (const [index, word] of words.entries()) {
    if (word === '-p' || word === '--port') {
      last = readPortValue(words[index + 1])
      continue
    }
    const attached = /^(?:-p=?|--port=)(\d+|\$.*)$/.exec(word)
    if (attached) last = readPortValue(attached[1])
  }
  return last
}

/** The name of a program as the shell finds it: no folders (either separator), no Windows launcher extension (`.cmd`, `.exe`, `.bat`, `.ps1`), lower case, so `node_modules\.bin\Next.CMD` is `next`. */
function programName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? '')
    .replace(/\.(?:cmd|exe|bat|ps1)$/i, '')
    .toLowerCase()
}

/** Remembers the first command the reader could not interpret, for the source text: values of other assignments are masked, control characters stripped, and the text cut. */
function noteUnread(reader: Reader, words: string[]): void {
  if (reader.unread !== undefined) return
  const masked = words
    .map((word) => word.replace(/^((?!PORT=)\w+)=.*$/, '$1=…'))
    .join(' ')
  reader.unread = cutTextToFit(
    stripTerminalControls(masked),
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

/** Where the prefix scan goes after a wrapper form: the next word's index and the wrapper whose flags are skipped from there. */
type WrapperStep = { next: number; wrapper: string | undefined }

/**
 * Reads one word of a command's prefix as a wrapper form: a flag of the wrapper before it, a runner (`cross-env`, `env`, `npx`, `bunx`), `pnpm exec`, `pnpm next` (the binary, when no script is named next) or `dotenv … --`.
 * @returns The step past it, or `undefined` when the word starts the program.
 */
function readWrapperStep(
  words: string[],
  index: number,
  wrapper: string | undefined,
  scripts: Record<string, unknown> | undefined,
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
      : { next: separator + 1, wrapper: undefined }
  }
  return undefined
}

/**
 * Separates a command's leading `NAME=value` words and wrappers from the program that runs.
 * @returns The `PORT` assigned before the program (if any), whether a `PORT=` value was a variable the reader cannot resolve, whether the words were an `export`/`set` statement, and the program with its arguments.
 */
function splitCommandPrefix(
  words: string[],
  scripts: Record<string, unknown> | undefined,
): {
  port?: number
  unresolved: boolean
  exported: boolean
  program: string[]
} {
  let port: number | undefined
  let unresolved = false
  let exported = false
  let wrapper: string | undefined
  let index = 0
  while (index < words.length) {
    const word = words[index]!
    if (word === 'export' || word === 'set') {
      exported = true
      wrapper = undefined
      index += 1
    } else if (/^\w+=/.test(word)) {
      const assigned = /^PORT=/.test(word) ? readPortValue(word.slice(5)) : {}
      port = assigned.port ?? port
      unresolved ||= assigned.unresolved === true
      index += 1
    } else {
      const step = readWrapperStep(words, index, wrapper, scripts)
      if (!step) break
      index = step.next
      wrapper = step.wrapper
    }
  }
  return { port, unresolved, exported, program: words.slice(index) }
}

/** Reads the command line a wrapper runs from its quoted argument: `sh -c '…'`, `bash -c '…'`, `cmd /c "…"` and `cross-env-shell "…"`; `undefined` for any other program. */
function readNestedLine(program: string[]): string | undefined {
  const name = programName(program[0] ?? '')
  if (name === 'cross-env-shell')
    return program.length > 1 ? program.slice(1).join(' ') : undefined
  if (SHELLS.has(name)) {
    const flag = program.findIndex(
      (word, index) => index > 0 && /^-[a-z]*c[a-z]*$/.test(word),
    )
    return flag > 0 ? program[flag + 1] : undefined
  }
  if (name === 'cmd') {
    const flag = program.findIndex(
      (word, index) => index > 0 && /^\/[ck]$/i.test(word),
    )
    return flag > 0 ? program.slice(flag + 1).join(' ') : undefined
  }
  return undefined
}

/** Reads the port of a program that is `next` (also by path, with a launcher extension, or as `node [flags] …/next`); `undefined` for another program or another `next` subcommand such as `build`. */
function readNextProgram(program: string[]): PortValue | undefined {
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
  return readPortFlag(rest)
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
 * @param inherited - A `PORT` the outer line assigned before this one, such as `PORT=4000 sh -c "next dev"`.
 */
function readCommandLine(
  line: string,
  reader: Reader,
  depth: number,
  inherited?: number,
): DevelopmentCommand | undefined {
  let exportedPort = inherited
  for (const words of splitShellCommandLine(line)) {
    // A subshell, a group or a command substitution is never interpreted.
    if (hasUnreadableSyntax(words)) {
      noteUnread(reader, words)
      continue
    }
    const prefix = splitCommandPrefix(words, reader.scripts)
    if (prefix.unresolved) noteUnread(reader, words)
    if (prefix.exported) {
      exportedPort = prefix.port ?? exportedPort
      continue
    }
    const found = readProgram(
      prefix.program,
      prefix.port ?? exportedPort,
      reader,
      depth,
    )
    if (found) return found
    // `next` behind a wrapper the reader does not know is told, not skipped silently.
    if (mentionsNext(prefix.program)) noteUnread(reader, words)
  }
  return undefined
}

/** Reads one program (after its prefix): a quoted command line, `next`, `concurrently`, or a package-manager delegation. */
function readProgram(
  program: string[],
  assigned: number | undefined,
  reader: Reader,
  depth: number,
): DevelopmentCommand | undefined {
  const nested = readNestedLine(program)
  if (nested !== undefined)
    return mayDescend(reader, depth, program)
      ? readCommandLine(nested, reader, depth + 1, assigned)
      : undefined
  const next = readNextProgram(program)
  if (next) {
    if (next.unresolved) noteUnread(reader, program)
    if (next.port !== undefined) return { port: next.port, via: 'flag' }
    return assigned !== undefined && !next.unresolved
      ? { port: assigned, via: 'assignment' }
      : {}
  }
  if (programName(program[0] ?? '') === 'concurrently')
    return readConcurrently(program, assigned, reader, depth)
  return readDelegatedScript(program, assigned, reader, depth)
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
  word: string,
  assigned: number | undefined,
  reader: Reader,
  depth: number,
): DevelopmentCommand | undefined {
  const reference = /^(?:npm|pnpm|yarn|bun):(.+)$/.exec(word)?.[1]
  // A plain argument holds no blank and is no script reference.
  if (reference === undefined && !/\s/.test(word)) return undefined
  if (!mayDescend(reader, depth, [word])) return undefined
  if (reference === undefined)
    return readCommandLine(word, reader, depth + 1, assigned)
  const name = resolveScriptReference(reference, reader.scripts)
  if (name === undefined) {
    noteUnread(reader, [word])
    return undefined
  }
  const found = readCommandLine(
    String(reader.scripts?.[name]),
    reader,
    depth + 1,
    assigned,
  )
  return found && { ...found, delegate: found.delegate ?? name }
}

/** Reads `concurrently`'s arguments in order; the first that gives `next dev` decides. */
function readConcurrently(
  program: string[],
  assigned: number | undefined,
  reader: Reader,
  depth: number,
): DevelopmentCommand | undefined {
  for (const word of program.slice(1)) {
    const found = readConcurrentlyArgument(word, assigned, reader, depth)
    if (found) return found
  }
  return undefined
}

/** Follows `npm run x` and its kin into script `x`, down to {@link DEVELOPMENT_SCRIPT_NESTING_LIMIT}: arguments after the name win, then the script's own declaration, then the assignment before the delegation. */
function readDelegatedScript(
  program: string[],
  assigned: number | undefined,
  reader: Reader,
  depth: number,
): DevelopmentCommand | undefined {
  const delegation = reader.scripts ? readDelegation(program) : undefined
  const script = delegation && reader.scripts?.[delegation.name]
  if (!delegation || typeof script !== 'string') return undefined
  if (!mayDescend(reader, depth, program)) return undefined
  const inner = readCommandLine(script, reader, depth + 1, assigned)
  if (!inner) return undefined
  const delegate = inner.delegate ?? delegation.name
  const flag = readPortFlag(delegation.args)
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
  const reader: Reader = { scripts: undefined }
  try {
    const declared: unknown = JSON.parse(packageText ?? '')?.scripts
    if (declared && typeof declared === 'object')
      reader.scripts = declared as Record<string, unknown>
  } catch {
    // A package.json that is absent or not JSON declares nothing; Next itself will report it.
  }
  const dev = reader.scripts?.dev
  const found =
    typeof dev === 'string' ? readCommandLine(dev, reader, 0) : undefined
  if (found?.port !== undefined)
    return { port: found.port, source: describeSource(found) }
  return {
    port: DEVELOPMENT_SERVER_DEFAULT_PORT,
    source:
      reader.unread === undefined
        ? "Next's default port"
        : `Next's default port, taken because the dev script has a form Codebook does not read: "${reader.unread}"`,
  }
}
