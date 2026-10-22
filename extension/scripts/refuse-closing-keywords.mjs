// Refuses a Bash command that puts a closing keyword right before an Issue number in the text of a pull request (Issue #98).
//
//   node extension/scripts/refuse-closing-keywords.mjs        (the hook's JSON arrives on standard input)
//
// Why: GitHub closes an Issue when a merged pull request's description or title puts `close`, `fix` or `resolve` (in any
// form and letter case) right before the Issue's number. This project closes its Issues by hand, after the merge, with a
// comment; PR #91's "Close #90" closed Issue #90 at the merge, before that comment.
//
// Called by the `PreToolUse` hook for the `Bash` tool in `.claude/settings.json`; Claude Code writes
// `{ tool_name, tool_input: { command }, cwd, … }` to standard input. Exit code 0 lets the command run (also for input that
// is not JSON, for another tool and for a command that writes no pull request text); 2 blocks it, and Claude Code shows
// standard error to the model; 1 is a failure of this script, which Claude Code shows without blocking.
//
// It reads the command line, never runs it. A command that writes pull request text is `gh pr create|edit|merge` or
// `gstack-post pr-body|pr-create|pr-title`, whatever path calls it. Its text is the file of `--body-file`/`-F` and
// `--title-file` (a relative path starts at the hook's `cwd`) and the value of `--body`/`-b`, `--title`/`-t` and `--subject`.
// What the shell would expand is expanded for the simple cases the `/ship` template uses: variables the command line
// assigned before (`$NAME`, `${NAME}`, `${NAME:?…}`, `${NAME:-…}`), `$(pwd)` and `$(git rev-parse --show-toplevel …)`.
// What it cannot see is skipped, never guessed: standard input (`--body-file -`, a heredoc fed to the command), a file that
// cannot be read, any other command substitution, a `cd` earlier in the line, and a command inside a double-quoted `$(…)`.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The variable whose value `1`, assigned in the command line before a pull request command, lets that command carry a closing keyword on purpose. */
const ALLOW_CLOSING_KEYWORD_NAME = 'CODEBOOK_ALLOW_CLOSING_KEYWORD'
const ALLOW_CLOSING_KEYWORD_ASSIGNMENT = `${ALLOW_CLOSING_KEYWORD_NAME}=1`

/** Claude Code blocks the tool call on this exit code and shows standard error to the model. */
const BLOCKING_EXIT_CODE = 2
/** Claude Code shows a failure of the hook itself on this exit code and lets the tool call run. */
const FAILURE_EXIT_CODE = 1

/** A pull request text is far below GitHub's limit of 65,536 characters, so a larger file is no pull request text and is skipped (it may also be a device or a pipe). */
const MAX_TEXT_FILE_BYTES = 1_048_576

/** The sentence that ends a refusal. */
const REFUSAL_FIX = `Write a non-closing reference such as \`Refs #N\` instead, or allow a deliberate closing reference by prefixing the command with \`${ALLOW_CLOSING_KEYWORD_ASSIGNMENT}\`.`

/**
 * A closing keyword of GitHub, then colons and spaces, then the Issue it names: `#123`, `owner/repo#123`, or the URL of an Issue or pull request on github.com.
 * The keyword stands at a word boundary, so `unclosed #5` and `fixed-width #5` do not match, nor does a keyword without a number.
 */
const CLOSING_REFERENCE = new RegExp(
  String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[:\s]*` +
    String.raw`(?:#\d+|[\w.-]+/[\w.-]+#\d+|https?://(?:www\.)?github\.com/[\w.-]+/[\w.-]+/(?:issues|pull)/\d+)`,
  'i',
)

/** Which actions of `gh pr` write a pull request's text (`merge` writes the merge commit's subject and body). */
const GH_PULL_REQUEST_ACTIONS = new Set(['create', 'edit', 'merge'])
/** Which actions of `gstack-post` write a pull request's text. */
const GSTACK_POST_ACTIONS = new Set(['pr-body', 'pr-create', 'pr-title'])

/** The options that carry pull request text, by the way they carry it: the text itself, or the file that holds it. */
const TEXT_OPTION_KINDS = new Map([
  ['--body', 'text'],
  ['-b', 'text'],
  ['--title', 'text'],
  ['-t', 'text'],
  ['--subject', 'text'],
  ['--body-file', 'file'],
  ['-F', 'file'],
  ['--title-file', 'file'],
])

/** An assignment word of a command line: `NAME=value`. */
const ASSIGNMENT_WORD = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/
/** A variable the shell would expand: `$NAME`, `${NAME}`, or `${NAME:?…}`, `${NAME:-…}`, `${NAME:=…}`. */
const VARIABLE_REFERENCE =
  /\$(?:\{([A-Za-z_]\w*)(?::([-=?])([^}]*))?\}|([A-Za-z_]\w*))/g
/** A command substitution of a file path that is worth expanding: `$(pwd)` or the `/ship` template's `$(git rev-parse --show-toplevel 2>/dev/null || pwd)`. */
const PATH_SUBSTITUTION =
  /\$\(\s*(?:(pwd)|git\s+rev-parse\s+--show-toplevel(?:\s+2>\s*\/dev\/null)?(?:\s*\|\|\s*pwd)?)\s*\)/g
/** The value of `--body "$(cat <<'EOF' … EOF)"`, the form Claude Code writes for a pull request body: the heredoc between the opening line and the delimiter. */
const HEREDOC_SUBSTITUTION =
  /^\$\(\s*cat\s+<<-?\s*(['"]?)([\w.-]+)\1[ \t]*\n([\s\S]*?)\n?\2\s*\)$/
/** The start of a heredoc (`<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"`, `<<\EOF`), not of a here-string (`<<<`). */
const HEREDOC_START =
  /(?<!<)<<(?!<)(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([\w.-]+))/
/** The characters (private-use code points, never typed in a command) that enclose the number of a heredoc body in the mark that stands in for it while the command line is split. */
const BODY_MARK_START = String.fromCodePoint(0xe000)
const BODY_MARK_END = String.fromCodePoint(0xe001)
/** Finds the marks again, so the body returns to the word that holds its mark. */
const BODY_MARK_PATTERN = new RegExp(
  `${BODY_MARK_START}(\\d+)${BODY_MARK_END}`,
  'g',
)
/** What ends a command before it, apart from `&&` (see {@link separatorLength}): `;`, `|` (also `||`), a line break, a subshell's or substitution's parenthesis and a backtick. */
const SEPARATOR_CHARACTERS = new Set([';', '|', '\n', '(', ')', '`'])
/** The characters a backslash escapes inside double quotes; before any other it stays a backslash. */
const DOUBLE_QUOTE_ESCAPABLE = new Set(['$', '`', '"', '\\'])

/**
 * @typedef {object} PullRequestTextOption
 * @property {string} option - The option as the command line wrote it (`--body-file`, `-b`, …).
 * @property {string} value - The option's value after variables were expanded: the path when `isFile`, else the text itself.
 * @property {boolean} isFile - Whether the value names the file that holds the text.
 */

/**
 * @typedef {object} PullRequestCommand
 * @property {boolean} isClosingKeywordAllowed - Whether the command line assigned `CODEBOOK_ALLOW_CLOSING_KEYWORD=1` before this command.
 * @property {PullRequestTextOption[]} textOptions - The options of the command that carry text, in the order written.
 */

/**
 * Finds the lines of a text that put a closing keyword right before an Issue reference.
 *
 * Why: this is the rule of Issue #98 in one place, so the hook and its tests apply the same pattern.
 * Called by {@link listClosingKeywordRefusals} for every pull request text it reads.
 *
 * @param text - A pull request title or description; lines end with `\n`, `\r\n` or `\r`.
 * @returns One entry per matching line, in order: the 1-based line number and the line without surrounding whitespace. Empty when no line matches.
 *
 * @example
 * ```js
 * findClosingReferences('Refs #12\n  Close #90 after the merge.\nunclosed #5')
 * // => [{ lineNumber: 2, lineText: 'Close #90 after the merge.' }]
 * ```
 */
export function findClosingReferences(text) {
  return text
    .split(/\r\n|\r|\n/)
    .flatMap((line, index) =>
      CLOSING_REFERENCE.test(line)
        ? [{ lineNumber: index + 1, lineText: line.trim() }]
        : [],
    )
}

/**
 * Hides the bodies of heredocs from the word splitter and keeps them aside.
 *
 * Why: a heredoc body is free text (`it's`, an unmatched quote or parenthesis, `"two words"`), which would end a quoted word at the wrong place and swallow or break the commands after it. Claude Code's own form of a pull request body is `--body "$(cat <<'EOF' … EOF)"`.
 * Called by {@link splitCommandSegments} before it splits.
 *
 * @param commandLine - The command line as the Bash tool received it.
 * @returns The command line with each heredoc body replaced by a mark, and the bodies by the number inside their mark. A heredoc with no delimiter line is left as it is.
 *
 * @example
 * ```js
 * maskHeredocBodies("cat <<'EOF'\nit's\nEOF\nls")
 * // => { maskedLine: "cat <<'EOF'\n<mark of body 0>\nEOF\nls", bodies: ["it's"] }
 * ```
 */
function maskHeredocBodies(commandLine) {
  const lines = commandLine.split('\n')
  const keptLines = []
  const bodies = []
  let lineIndex = 0
  while (lineIndex < lines.length) {
    const line = lines[lineIndex]
    keptLines.push(line)
    lineIndex += 1
    const start = HEREDOC_START.exec(line)
    if (start === null) continue
    const [, dash, singleQuoted, doubleQuoted, bare] = start
    const delimiter = singleQuoted ?? doubleQuoted ?? bare
    // `<<-` lets tabs stand before the delimiter.
    const delimiterLineIndex = lines.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex >= lineIndex &&
        (dash === '-' ? candidate.replace(/^\t+/, '') : candidate) ===
          delimiter,
    )
    // Without a delimiter line the text is no heredoc this script can tell from the rest.
    if (delimiterLineIndex === -1) continue
    bodies.push(lines.slice(lineIndex, delimiterLineIndex).join('\n'))
    keptLines.push(`${BODY_MARK_START}${bodies.length - 1}${BODY_MARK_END}`)
    // The delimiter line itself is kept by the next turn.
    lineIndex = delimiterLineIndex
  }
  return { maskedLine: keptLines.join('\n'), bodies }
}

/**
 * Reads a single-quoted string, which keeps every character up to the next single quote.
 *
 * Called by {@link splitCommandSegments} at a single quote outside any other quote.
 *
 * @param line - The command line.
 * @param openingIndex - The index of the opening quote.
 * @returns The text between the quotes, and the index after the closing quote (the line's end when the quote is not closed).
 *
 * @example
 * ```js
 * readSingleQuoted("a 'b c' d", 2) // => { text: 'b c', nextIndex: 7 }
 * ```
 */
function readSingleQuoted(line, openingIndex) {
  const closingIndex = line.indexOf("'", openingIndex + 1)
  const endIndex = closingIndex === -1 ? line.length : closingIndex
  return {
    text: line.slice(openingIndex + 1, endIndex),
    nextIndex: endIndex + 1,
  }
}

/**
 * Reads a double-quoted string: a backslash escapes only `$`, a backtick, `"` and `\`, and joins a line break to the next line.
 *
 * Called by {@link splitCommandSegments} at a double quote outside any other quote.
 *
 * @param line - The command line.
 * @param openingIndex - The index of the opening quote.
 * @returns The text between the quotes with the escapes resolved, and the index after the closing quote (the line's end when the quote is not closed).
 *
 * @example
 * ```js
 * readDoubleQuoted('x "say \\"hi\\"" y', 2) // => { text: 'say "hi"', nextIndex: 14 }
 * ```
 */
function readDoubleQuoted(line, openingIndex) {
  let text = ''
  let index = openingIndex + 1
  while (index < line.length && line[index] !== '"') {
    const escaped = line[index + 1]
    if (line[index] === '\\' && escaped === '\n') {
      // A backslash before a line break joins the lines.
      index += 2
    } else if (line[index] === '\\' && DOUBLE_QUOTE_ESCAPABLE.has(escaped)) {
      text += escaped
      index += 2
    } else {
      text += line[index]
      index += 1
    }
  }
  return { text, nextIndex: index + 1 }
}

/**
 * Says how many characters of a command separator start at an index outside any quote.
 *
 * Called by {@link splitCommandSegments} for every character it reads outside a quote.
 *
 * @param line - The command line.
 * @param index - The index to look at.
 * @returns 2 for `&&`, 1 for a character of {@link SEPARATOR_CHARACTERS}, else 0. A single `&` is no separator, so `2>&1` stays one word.
 *
 * @example
 * ```js
 * separatorLength('a && b', 2) // => 2
 * separatorLength('a 2>&1', 4) // => 0
 * ```
 */
function separatorLength(line, index) {
  if (line[index] === '&') return line[index + 1] === '&' ? 2 : 0
  return SEPARATOR_CHARACTERS.has(line[index]) ? 1 : 0
}

/**
 * Splits a command line into commands and each command into words, as a shell would read the quoting.
 *
 * Why: the hook must tell the words of a pull request command (`--body-file`, a path, a quoted text) from the text around it; a pattern over the raw line would also match a commit message that mentions `gh pr create`.
 * Called by {@link findPullRequestCommands}.
 *
 * Single quotes keep everything; double quotes keep everything but resolve `\"`, `\\`, `\$` and a backslash before a line break; a backslash outside quotes keeps the next character; `#` at the start of a word begins a comment. A command ends at `&&`, `||`, `;`, `|`, a line break, a parenthesis or a backtick. Heredoc bodies are set aside while the line is split and put back into the word that holds them.
 *
 * @param commandLine - The command line as the Bash tool received it.
 * @returns The commands in order, each a non-empty list of words with the quotes removed.
 *
 * @example
 * ```js
 * splitCommandSegments('gh pr edit 12 --body "a b" && git status | cat')
 * // => [['gh', 'pr', 'edit', '12', '--body', 'a b'], ['git', 'status'], ['cat']]
 * ```
 */
export function splitCommandSegments(commandLine) {
  const { maskedLine, bodies } = maskHeredocBodies(commandLine)
  const segments = []
  let words = []
  let word = ''
  // True once a word has begun, so an empty quoted string ('' or "") still makes a word.
  let isInWord = false
  let index = 0

  /** Closes the word being read, if any. */
  const endWord = () => {
    if (isInWord) words.push(word)
    word = ''
    isInWord = false
  }
  /** Closes the command being read, if it has a word. */
  const endSegment = () => {
    endWord()
    if (words.length > 0) segments.push(words)
    words = []
  }

  while (index < maskedLine.length) {
    const character = maskedLine[index]
    const separatorSize = separatorLength(maskedLine, index)
    if (character === "'" || character === '"') {
      const quoted =
        character === "'"
          ? readSingleQuoted(maskedLine, index)
          : readDoubleQuoted(maskedLine, index)
      word += quoted.text
      isInWord = true
      index = quoted.nextIndex
    } else if (character === '\\') {
      // A backslash keeps the next character as it is; before a line break it joins the lines.
      const escaped = maskedLine[index + 1]
      if (escaped !== undefined && escaped !== '\n') {
        word += escaped
        isInWord = true
      }
      index += 2
    } else if (character === '#' && !isInWord) {
      // A comment runs to the end of its line; the line break itself still ends the command.
      const lineEnd = maskedLine.indexOf('\n', index)
      index = lineEnd === -1 ? maskedLine.length : lineEnd
    } else if (separatorSize > 0) {
      endSegment()
      index += separatorSize
    } else if (/\s/.test(character)) {
      endWord()
      index += 1
    } else {
      word += character
      isInWord = true
      index += 1
    }
  }
  endSegment()

  return segments.map((segment) =>
    segment.map((segmentWord) =>
      segmentWord.replace(BODY_MARK_PATTERN, (_mark, bodyIndex) =>
        String(bodies[Number(bodyIndex)] ?? ''),
      ),
    ),
  )
}

/**
 * Looks a variable up where the shell would find it: the command line's own assignments first, then the environment.
 *
 * Called by {@link expandVariables}.
 *
 * @param name - The variable's name.
 * @param variables - The variables the command line assigned before this point.
 * @param environment - The environment of the hook, which the Bash tool's shell inherits for the most part.
 * @returns The value, or `undefined` when neither knows the name.
 *
 * @example
 * ```js
 * lookupVariable('A', new Map([['A', '1']]), { A: '2' }) // => '1'
 * lookupVariable('B', new Map(), { B: '2' })             // => '2'
 * ```
 */
function lookupVariable(name, variables, environment) {
  return (
    variables.get(name) ??
    (Object.hasOwn(environment, name) ? environment[name] : undefined)
  )
}

/**
 * Expands the variables of a word that the shell would expand and this script knows.
 *
 * Why: the `/ship` template hands its files over as `--title-file "$TITLE_FILE"` and `--body-file "${PR_BODY_FILE:?…}"`, so a hook that read only literal paths would skip the very flow Issue #98 guards.
 * Called by {@link findPullRequestCommands} for every option word and every assigned value.
 *
 * @param text - A word with its quotes already removed.
 * @param variables - The variables the command line assigned before this word.
 * @param environment - The environment to fall back on.
 * @returns The text with `$NAME`, `${NAME}`, `${NAME:?…}`, `${NAME:-…}` and `${NAME:=…}` replaced by the value, or by the default of `:-` and `:=` when the variable is unset or empty. A variable nobody knows stays as it is, so a path made from it cannot be read and is skipped.
 *
 * @example
 * ```js
 * expandVariables('${BODY:?restore it}/b.md', new Map([['BODY', '/tmp']]), {}) // => '/tmp/b.md'
 * expandVariables('$UNKNOWN/b.md', new Map(), {})                              // => '$UNKNOWN/b.md'
 * ```
 */
function expandVariables(text, variables, environment) {
  return text.replace(
    VARIABLE_REFERENCE,
    (reference, bracedName, operator, operand, bareName) => {
      const value = lookupVariable(
        bracedName ?? bareName,
        variables,
        environment,
      )
      if (value !== undefined && value !== '') return value
      // `${NAME:-default}` and `${NAME:=default}` give the default; `${NAME:?…}` and a bare name stay unresolved.
      return operator === '-' || operator === '=' ? operand : reference
    },
  )
}

/**
 * Records the variables a command of the command line assigns for the commands after it.
 *
 * Called by {@link findPullRequestCommands} for every command that is no pull request command.
 *
 * Only a command made of assignments (`A=1 B=2`) and `export A=1` set a variable for what follows; `A=1 command` sets it for that command alone, as in a shell.
 *
 * @param words - The words of one command.
 * @param variables - The variables so far; this call adds to them.
 * @param environment - The environment to fall back on while the values are expanded.
 *
 * @example
 * ```js
 * const variables = new Map()
 * recordAssignments(['export', 'FILE=/tmp/b.md'], variables, {})
 * // variables is now Map { 'FILE' => '/tmp/b.md' }
 * ```
 */
function recordAssignments(words, variables, environment) {
  const isExport = words[0] === 'export'
  const assignedWords = isExport ? words.slice(1) : words
  if (!isExport && !assignedWords.every((word) => ASSIGNMENT_WORD.test(word)))
    return
  for (const word of assignedWords) {
    const assignment = ASSIGNMENT_WORD.exec(word)
    if (assignment !== null)
      variables.set(
        assignment[1],
        expandVariables(assignment[2], variables, environment),
      )
  }
}

/**
 * Finds where a command of a pull request starts in the words of one command.
 *
 * Called by {@link findPullRequestCommands}.
 *
 * The program may stand after assignments, `env`, `time`, `if` and the like, and may be called by a path (`~/.claude/skills/gstack/bin/gstack-post`), so the words are searched for it instead of expecting it first.
 *
 * @param words - The words of one command.
 * @returns Where the program is (`gh` of `gh pr create|edit|merge`, `gstack-post` of `gstack-post pr-body|pr-create|pr-title`) and where the words after the action begin; `undefined` when the command writes no pull request text.
 *
 * @example
 * ```js
 * findPullRequestSignature(['X=1', '/opt/homebrew/bin/gh', 'pr', 'edit', '12']) // => { programIndex: 1, argumentsIndex: 4 }
 * findPullRequestSignature(['gh', 'issue', 'view', '98'])                       // => undefined
 * ```
 */
function findPullRequestSignature(words) {
  for (const [programIndex, word] of words.entries()) {
    const program = word.slice(word.lastIndexOf('/') + 1)
    if (
      program === 'gh' &&
      words[programIndex + 1] === 'pr' &&
      GH_PULL_REQUEST_ACTIONS.has(words[programIndex + 2])
    )
      return { programIndex, argumentsIndex: programIndex + 3 }
    if (
      program === 'gstack-post' &&
      GSTACK_POST_ACTIONS.has(words[programIndex + 1])
    )
      return { programIndex, argumentsIndex: programIndex + 2 }
  }
  return undefined
}

/**
 * Picks the options that carry text out of the words after a pull request command's action.
 *
 * Called by {@link findPullRequestCommands}.
 *
 * `--name=value` carries its value; `--name value` takes the next word, whatever it looks like, as the option parser of `gh` does. Other options are passed over.
 *
 * @param words - The words after the action, variables already expanded.
 * @returns The text options in the order written. An option with no value at the end of the command is left out.
 *
 * @example
 * ```js
 * readTextOptions(['--base', 'main', '--title-file=t.md', '-b', 'Refs #1'])
 * // => [{ option: '--title-file', value: 't.md', isFile: true }, { option: '-b', value: 'Refs #1', isFile: false }]
 * ```
 */
function readTextOptions(words) {
  const textOptions = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    const equalsIndex = word.startsWith('--') ? word.indexOf('=') : -1
    const option = equalsIndex === -1 ? word : word.slice(0, equalsIndex)
    const kind = TEXT_OPTION_KINDS.get(option)
    if (kind === undefined) continue
    const value =
      equalsIndex === -1 ? words[index + 1] : word.slice(equalsIndex + 1)
    // The word after `--name` is its value, not an option.
    if (equalsIndex === -1) index += 1
    if (value !== undefined)
      textOptions.push({ option, value, isFile: kind === 'file' })
  }
  return textOptions
}

/**
 * Finds the commands of a command line that write the text of a pull request, with the options that carry it.
 *
 * Why: the hook has to know which files and strings of a Bash command will become a pull request's title or description, and whether the command line allowed a closing keyword on purpose.
 * Called by {@link listClosingKeywordRefusals}; the tests call it with the command lines of `/ship` and of Claude Code.
 *
 * A command line allows a closing keyword for a command when the assignment `CODEBOOK_ALLOW_CLOSING_KEYWORD=1` stands before the command's program, in the same command (`CODEBOOK_ALLOW_CLOSING_KEYWORD=1 gh pr edit …`, `env …`) or in an earlier one (`export CODEBOOK_ALLOW_CLOSING_KEYWORD=1 && …`); one after the command does not count.
 *
 * @param commandLine - The command line as the Bash tool received it.
 * @param environment - The environment to expand variables from when the command line did not assign them; `process.env` by default.
 * @returns One entry per `gh pr create|edit|merge` and `gstack-post pr-body|pr-create|pr-title`, in order. Empty when the line has none.
 *
 * @example
 * ```js
 * findPullRequestCommands('BODY=/tmp/b.md\ngstack-post pr-body 12 --body-file "$BODY"', {})
 * // => [{ isClosingKeywordAllowed: false, textOptions: [{ option: '--body-file', value: '/tmp/b.md', isFile: true }] }]
 * findPullRequestCommands('git status', {}) // => []
 * ```
 */
export function findPullRequestCommands(
  commandLine,
  environment = process.env,
) {
  const variables = new Map()
  const commands = []
  for (const words of splitCommandSegments(commandLine)) {
    const signature = findPullRequestSignature(words)
    if (signature === undefined) {
      recordAssignments(words, variables, environment)
      continue
    }
    const isClosingKeywordAllowed =
      words
        .slice(0, signature.programIndex)
        .includes(ALLOW_CLOSING_KEYWORD_ASSIGNMENT) ||
      variables.get(ALLOW_CLOSING_KEYWORD_NAME) === '1'
    // What follows the program and its action (`gh pr create`) are options and their values.
    const argumentWords = words.slice(signature.argumentsIndex)
    commands.push({
      isClosingKeywordAllowed,
      textOptions: readTextOptions(
        argumentWords.map((word) =>
          expandVariables(word, variables, environment),
        ),
      ),
    })
  }
  return commands
}

/**
 * Finds the top folder of the repository that holds a folder, the way `git rev-parse --show-toplevel` would.
 *
 * Called by {@link resolveTextFilePath} for `$(git rev-parse --show-toplevel …)`.
 *
 * @param directory - A folder inside the repository.
 * @returns The nearest folder at or above `directory` that has a `.git` (a folder, or a file in a linked worktree); `directory` itself when there is none.
 *
 * @example
 * ```js
 * findRepositoryRoot('/repo/extension/scripts') // => '/repo'
 * ```
 */
function findRepositoryRoot(directory) {
  for (
    let candidate = directory;
    dirname(candidate) !== candidate;
    candidate = dirname(candidate)
  )
    if (existsSync(join(candidate, '.git'))) return candidate
  return directory
}

/**
 * Turns the path of a text option into the absolute path the command would read.
 *
 * Called by {@link readPullRequestText}.
 *
 * @param path - The option's value after variables were expanded.
 * @param workingDirectory - The folder a relative path starts at: the hook input's `cwd`.
 * @returns The absolute path, with a leading `~` replaced by the home folder, and `$(pwd)` and `$(git rev-parse --show-toplevel …)` replaced by the folder and its repository's top folder.
 *
 * @example
 * ```js
 * resolveTextFilePath('b.md', '/repo')                                                        // => '/repo/b.md'
 * resolveTextFilePath('$(git rev-parse --show-toplevel 2>/dev/null || pwd)/t.md', '/repo/sub') // => '/repo/t.md'
 * ```
 */
function resolveTextFilePath(path, workingDirectory) {
  const withoutSubstitutions = path
    .replace(/^~(?=\/|$)/, () => homedir())
    .replace(PATH_SUBSTITUTION, (_substitution, printWorkingDirectory) =>
      printWorkingDirectory === undefined
        ? findRepositoryRoot(workingDirectory)
        : workingDirectory,
    )
  return resolve(workingDirectory, withoutSubstitutions)
}

/**
 * Reads the text one option of a pull request command carries.
 *
 * Called by {@link listClosingKeywordRefusals}.
 *
 * @param textOption - An option found by {@link findPullRequestCommands}.
 * @param workingDirectory - The folder a relative path starts at.
 * @returns The text and where it came from (the file's absolute path, or the option's name); for `--body "$(cat <<'EOF' … EOF)"` the text is the heredoc alone, so its line numbers are the body's. `undefined` for standard input (`-`), a file that cannot be read, and anything that is no regular file within {@link MAX_TEXT_FILE_BYTES}.
 *
 * @example
 * ```js
 * readPullRequestText({ option: '--body', value: 'Refs #1', isFile: false }, '/repo') // => { source: '--body', text: 'Refs #1' }
 * readPullRequestText({ option: '--body-file', value: '-', isFile: true }, '/repo')   // => undefined
 * ```
 */
function readPullRequestText(textOption, workingDirectory) {
  if (!textOption.isFile) {
    const heredoc = HEREDOC_SUBSTITUTION.exec(textOption.value)
    return {
      source: textOption.option,
      text: heredoc === null ? textOption.value : heredoc[3],
    }
  }
  // `-` reads standard input, which the hook cannot see.
  if (textOption.value === '-') return undefined
  const path = resolveTextFilePath(textOption.value, workingDirectory)
  try {
    const stats = statSync(path)
    if (!stats.isFile() || stats.size > MAX_TEXT_FILE_BYTES) return undefined
    return { source: path, text: readFileSync(path, 'utf8') }
  } catch {
    // A file that does not exist or cannot be read is skipped: the command itself will report it.
    return undefined
  }
}

/**
 * Says whether a value is an object that can hold properties.
 *
 * Called by {@link listClosingKeywordRefusals} on the parsed hook input.
 *
 * @param value - Anything `JSON.parse` returned.
 * @returns `true` for an object or an array; `false` for `null` and the primitives.
 *
 * @example
 * ```js
 * isRecord({ tool_name: 'Bash' }) // => true
 * isRecord(null)                  // => false
 * ```
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null
}

/**
 * Lists the standard-error lines that refuse a Bash command, or none when it may run.
 *
 * Why: this is the hook's whole decision, apart from reading standard input, so the tests can call it without a process.
 * Called by {@link main}.
 *
 * @param hookInput - The parsed JSON of the `PreToolUse` event: `{ tool_name, tool_input: { command }, cwd }`.
 * @param environment - The environment to expand variables from; `process.env` by default.
 * @returns Empty when the tool is not Bash, the input has no command, no pull request command carries a closing keyword, or the command line allowed it. Otherwise one line per matching line, `Closing keyword before an Issue number in <file or option>, line <n>: <line>`, then one sentence of the fix.
 *
 * @example
 * ```js
 * listClosingKeywordRefusals({ tool_name: 'Bash', tool_input: { command: "gh pr edit 3 --body 'Fixes #3'" }, cwd: '/repo' })
 * // => ['Closing keyword before an Issue number in --body, line 1: Fixes #3', 'Write a non-closing reference such as `Refs #N` instead, or allow …']
 * ```
 */
export function listClosingKeywordRefusals(
  hookInput,
  environment = process.env,
) {
  if (!isRecord(hookInput) || hookInput.tool_name !== 'Bash') return []
  const commandLine = isRecord(hookInput.tool_input)
    ? hookInput.tool_input.command
    : undefined
  if (typeof commandLine !== 'string') return []
  const workingDirectory =
    typeof hookInput.cwd === 'string' && hookInput.cwd !== ''
      ? hookInput.cwd
      : process.cwd()

  const refusals = findPullRequestCommands(commandLine, environment)
    .filter((command) => !command.isClosingKeywordAllowed)
    .flatMap((command) => command.textOptions)
    .flatMap((textOption) => {
      const pullRequestText = readPullRequestText(textOption, workingDirectory)
      if (pullRequestText === undefined) return []
      return findClosingReferences(pullRequestText.text).map(
        ({ lineNumber, lineText }) =>
          `Closing keyword before an Issue number in ${pullRequestText.source}, line ${lineNumber}: ${lineText}`,
      )
    })
  return refusals.length === 0 ? [] : [...refusals, REFUSAL_FIX]
}

/**
 * Reads all of standard input as text.
 *
 * Called by {@link main}.
 *
 * @returns The bytes the hook's caller wrote, decoded as UTF-8; empty when nothing was written.
 *
 * @example
 * ```js
 * const input = await readStandardInput() // '{"tool_name":"Bash", …}'
 * ```
 */
async function readStandardInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Runs the hook: reads the event from standard input and, for a refusal, writes the lines to standard error and sets exit code 2.
 *
 * Called by this file when Node starts it as the program ({@link isRunAsScript}).
 *
 * @example
 * ```js
 * // echo '{"tool_name":"Bash","tool_input":{"command":"gh pr create --body \"Closes #1\""},"cwd":"/repo"}' | node refuse-closing-keywords.mjs
 * // stderr: Closing keyword before an Issue number in --body, line 1: Closes #1 …   exit code: 2
 * ```
 */
async function main() {
  let hookInput
  try {
    hookInput = JSON.parse(await readStandardInput())
  } catch {
    // Input that is not JSON is not a hook event this script knows: let the command run.
    return
  }
  const refusals = listClosingKeywordRefusals(hookInput)
  if (refusals.length === 0) return
  process.stderr.write(`${refusals.join('\n')}\n`)
  process.exitCode = BLOCKING_EXIT_CODE
}

/**
 * Says whether Node started this file as the program, as opposed to a test importing its functions.
 *
 * Called once below. It compares real paths, so a project folder reached through a symbolic link (`/tmp` on macOS) still counts; `import.meta.main` would need Node 24.2 or later.
 *
 * @returns `true` when the file named on Node's command line is this file.
 *
 * @example
 * ```js
 * isRunAsScript() // => true under `node refuse-closing-keywords.mjs`, false when imported by a test
 * ```
 */
function isRunAsScript() {
  const entryPath = process.argv[1]
  if (entryPath === undefined) return false
  try {
    return realpathSync(entryPath) === fileURLToPath(import.meta.url)
  } catch {
    // An entry that is not a file (`node -`) is not this file.
    return false
  }
}

if (isRunAsScript()) {
  main().catch((error) => {
    process.stderr.write(
      `refuse-closing-keywords failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = FAILURE_EXIT_CODE
  })
}
