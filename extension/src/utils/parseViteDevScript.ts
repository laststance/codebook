/** What an accepted `dev` script asks of Vite, as {@link parseViteDevScript} reads it. */
export type ViteDevScript = {
  /** Leading `NAME=value` assignments, passed to the launcher as an environment object and never through a shell. */
  assignments: Record<string, string>
  /** The Vite command word that was written: `dev`, `serve` or none. */
  subcommand: 'dev' | 'serve' | undefined
  /** `--port` given in the script; it overrides the config's port as Vite's own CLI does. */
  port: number | undefined
  /** `--mode` given in the script. */
  mode: string | undefined
  /** `--config` / `-c` given in the script, as written. */
  configFile: string | undefined
}

/** The outcome of reading a script: what it asks, or every refused element. */
export type ViteDevScriptReading =
  | { accepted: true; script: ViteDevScript }
  | { accepted: false; refused: string[] }

/** A package runner or shell word that is refused by name: it is a grammar word, never a value. */
const KNOWN_RUNNER_WORDS = new Set([
  'cross-env',
  'env',
  'npx',
  'bunx',
  'pnpm',
  'yarn',
  'npm',
  'bun',
  'node',
  'dotenv',
  'concurrently',
])

/** Characters that mean shell syntax: expansion, quoting, globbing, redirection, grouping or escape. */
const SHELL_SYNTAX_CHARACTERS = /[$`'"*?[\]{}<>&;|()\\!#]/

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

const OPERATOR_WORDS = new Set(['&&', ';', '|', '||', '&'])

/** The Vite options Codebook ignores: it binds `127.0.0.1` and opens no browser itself. */
const IGNORED_OPTIONS = new Set(['--host', '--open'])

/** Reading state shared by the option readers. */
type Reading = {
  words: string[]
  index: number
  refused: string[]
  forwarded: { port?: number; mode?: string; configFile?: string }
}

/** Names the shell syntax of a word without echoing the word. */
function describeSyntax(word: string, role: string): string {
  const characters = [
    ...new Set(
      [...word].filter((character) => SHELL_SYNTAX_CHARACTERS.test(character)),
    ),
  ].join(' ')
  return `${role} with shell syntax (${characters})`
}

/** The refusal of a word that is an operator, a separator or holds shell syntax; `undefined` for a plain word. */
function syntaxRefusalOf(word: string | undefined): string | undefined {
  if (word === undefined) return undefined
  if (OPERATOR_WORDS.has(word)) return `the operator ${word}`
  if (word === '--') return 'the argument separator --'
  if (SHELL_SYNTAX_CHARACTERS.test(word)) return describeSyntax(word, 'a word')
  return undefined
}

/** Names the first command word of a refused script: a known runner by name, any other word as `…`. */
function describeCommandWord(word: string | undefined): string {
  if (word === undefined)
    return 'an empty command (the script must start with vite)'
  if (KNOWN_RUNNER_WORDS.has(word)) return `the command word ${word}`
  return (
    syntaxRefusalOf(word) ??
    'the command word … (the script must start with vite)'
  )
}

/** Reads the leading `NAME=value` words into an environment object; returns the index of the first other word. */
function readAssignments(
  words: string[],
  assignments: Record<string, string>,
  refused: string[],
): number {
  let index = 0
  while (index < words.length && ASSIGNMENT.test(words[index]!)) {
    const word = words[index]!
    const equals = word.indexOf('=')
    const value = word.slice(equals + 1)
    if (SHELL_SYNTAX_CHARACTERS.test(value))
      refused.push(describeSyntax(value, 'an assignment value'))
    else assignments[word.slice(0, equals)] = value
    index += 1
  }
  return index
}

/** Stores a forwarded option's plain value, or refuses it. */
function storeForwarded(reading: Reading, name: string, value: string): void {
  if (!value || SHELL_SYNTAX_CHARACTERS.test(value)) {
    reading.refused.push(`the option ${name} without a plain value`)
    return
  }
  if (name === '--port') {
    const port = /^\d{1,5}$/.test(value) ? Number(value) : 0
    if (port < 1 || port > 65_535) reading.refused.push('the option --port=…')
    else reading.forwarded.port = port
    return
  }
  if (name === '--mode') reading.forwarded.mode = value
  else reading.forwarded.configFile = value
}

/** Reads one option word and the value that may follow it, moving the cursor past both. */
function readOption(reading: Reading, word: string): void {
  const equals = word.indexOf('=')
  const name = equals === -1 ? word : word.slice(0, equals)
  const next = reading.words[reading.index]
  // A value follows as the next word only when it is not an option and holds no syntax.
  const takesNext =
    equals === -1 &&
    next !== undefined &&
    !next.startsWith('-') &&
    syntaxRefusalOf(next) === undefined
  if (takesNext) reading.index += 1
  if (IGNORED_OPTIONS.has(name)) return
  if (!['--port', '--mode', '--config', '-c'].includes(name)) {
    reading.refused.push(`the option ${name}${equals === -1 ? '' : '=…'}`)
    return
  }
  const value = equals === -1 ? (takesNext ? next : '') : word.slice(equals + 1)
  storeForwarded(reading, name === '-c' ? '--config' : name, value)
}

/** Reads the words after `vite [dev|serve]`: options only. */
function readOptions(reading: Reading): void {
  while (reading.index < reading.words.length) {
    const word = reading.words[reading.index]!
    reading.index += 1
    const syntax = syntaxRefusalOf(word)
    if (syntax) reading.refused.push(syntax)
    else if (word.startsWith('-')) readOption(reading, word)
    else reading.refused.push('a positional argument …')
  }
}

/**
 * Reads a project's `dev` script against the fixed grammar `[NAME=value ...] vite [dev|serve] [--host [h]] [--open [p]] [--port N] [--mode M] [--config F]`, never running it.
 *
 * Why it exists: Codebook starts Vite itself instead of the script, so it accepts only scripts that Codebook's start reproduces exactly. Called by {@link assessViteWorkspace} before the launcher is spawned.
 * A refusal lists every refused element at once and never contains an assignment value, an operand or an unknown option's value.
 *
 * @param script - The text of `scripts.dev`.
 * @returns
 * - `accepted: true` with the assignments, subcommand and forwarded options
 * - `accepted: false` with each refused element: grammar words, option names and character classes only
 * @example
 * parseViteDevScript('VITE_X=1 vite dev --port 3010') // => { accepted: true, script: { assignments: { VITE_X: '1' }, subcommand: 'dev', port: 3010, … } }
 * parseViteDevScript('cross-env A=b vite && echo') // => { accepted: false, refused: ['the command word cross-env', 'the operator &&'] }
 */
export function parseViteDevScript(script: string): ViteDevScriptReading {
  const words = script.split(/\s+/).filter(Boolean)
  const assignments: Record<string, string> = {}
  const reading: Reading = { words, index: 0, refused: [], forwarded: {} }
  reading.index = readAssignments(words, assignments, reading.refused)
  if (words[reading.index] !== 'vite') {
    reading.refused.push(describeCommandWord(words[reading.index]))
    // The rest cannot be read as Vite options; its syntax is still listed.
    for (const word of words.slice(reading.index + 1)) {
      const syntax = syntaxRefusalOf(word)
      if (syntax) reading.refused.push(syntax)
    }
    return { accepted: false, refused: [...new Set(reading.refused)] }
  }
  reading.index += 1
  const written = words[reading.index]
  const subcommand =
    written === 'dev' || written === 'serve' ? written : undefined
  if (subcommand) reading.index += 1
  readOptions(reading)
  if (reading.refused.length)
    return { accepted: false, refused: [...new Set(reading.refused)] }
  return {
    accepted: true,
    script: { assignments, subcommand, ...spreadForwarded(reading.forwarded) },
  }
}

/** Gives every forwarded option a key, absent ones as `undefined`. */
function spreadForwarded(forwarded: Reading['forwarded']) {
  return {
    port: forwarded.port,
    mode: forwarded.mode,
    configFile: forwarded.configFile,
  }
}
