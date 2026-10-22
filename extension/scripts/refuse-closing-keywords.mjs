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
// is not JSON, for another tool, for a command line over 262,144 characters and for a command that writes no pull request
// text); 2 blocks it, and Claude Code shows standard error to the model; 1 is a failure of this script, which Claude Code
// shows without blocking.
//
// It reads the command line and never runs it. A command that writes pull request text is `gh pr create|edit|merge` or
// `gstack-post pr-body|pr-create|pr-title`, whatever path calls it, also inside `( … )`, `$( … )` and backticks. Its text is
// the file of `--body-file`/`-F` and `--title-file` and the value of `--body`/`-b`, `--title`/`-t` and `--subject`
// (`--name=value`, `-bTEXT` and `-b=TEXT` included). The line is followed in order, as a shell runs it, as far as this
// project's flows need:
//   - variables: `NAME=value`, `export`, `unset`, `$NAME`, `${NAME}`, `${NAME:?…}`, `${NAME:-…}`, and a value made of
//     `$(cat <<'EOF' … EOF)`, `$(pwd)` or `$(git rev-parse --show-toplevel …)`; `( … )`, `$( … )`, a pipeline element and a
//     background command keep their changes to themselves;
//   - the working directory: `cd` and `pushd` to a literal path, `~` or a known variable; a relative file starts there
//     (the hook's `cwd` first);
//   - standard input: `--body-file -` (or `/dev/stdin`) reads the heredoc, here-string or `< file` fed to that same command;
//   - a file that `cat > f <<'EOF'`, `cat >> f`, `cat <<'EOF' > f` or `tee f <<'EOF'` writes earlier in the line is read as
//     that heredoc (after the file's current content for `>>`), not as the disk has it before the line runs.
// What it cannot see is skipped, never guessed. These are the blind spots:
//   - `bash -c '…'`, `sh -c '…'` and `eval` (their program is one word), and any script, alias or function that wraps
//     `gh` or `gstack-post`;
//   - standard input from a pipe or a terminal (`cat f | gh pr edit --body-file -`);
//   - a file that an earlier command of the line writes in another way than the heredoc forms above (`echo … > f`,
//     `printf … > f`, `… | tee f`, `gh pr view … > f`): the whole file is skipped. `cp`, `mv`, `sed -i`, `python` and the
//     like are not noticed: the file is read as the disk has it before the line runs;
//   - the output of a command substitution other than the three above, backticks included: a value made of it is unknown,
//     a file named by it is skipped (so `f=$(mktemp); cat > "$f" <<'EOF' … EOF; gh pr create --body-file "$f"` is not
//     read), and of a text around it only the parts outside the substitution are read. In a heredoc whose delimiter is
//     not quoted only variables are expanded; its other substitutions stay as written;
//   - a variable that neither an assignment or `export` of the line nor the hook's environment gives (a loop variable,
//     the one `read` sets, one from an earlier Bash call): a file named by it is skipped, and in a text it stays as written;
//   - a directory that cannot be resolved (`cd -`, `popd`, `cd ~user`, `cd` to a variable nobody assigned or to any other
//     substitution): relative files after it are skipped, not read from the hook's `cwd`;
//   - which commands run: `if`, `for`, `while`, `&&`, `||` and functions are read as if every command ran once, in the
//     order written, so a `cd` or a file write that only some runs reach counts;
//   - a file that cannot be read, is no regular file or is larger than 262,144 bytes.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { isRunAsScript } from './utils/isRunAsScript.mjs'

/** The variable whose value `1`, assigned in the command line before a pull request command, lets that command carry a closing keyword on purpose. */
const ALLOW_CLOSING_KEYWORD_NAME = 'CODEBOOK_ALLOW_CLOSING_KEYWORD'
const ALLOW_CLOSING_KEYWORD_ASSIGNMENT = `${ALLOW_CLOSING_KEYWORD_NAME}=1`

/** Claude Code blocks the tool call on this exit code and shows standard error to the model. */
const BLOCKING_EXIT_CODE = 2
/** Claude Code shows a failure of the hook itself on this exit code and lets the tool call run. */
const FAILURE_EXIT_CODE = 1

/** A command line longer than this is let through unread. A pull request text is far below GitHub's limit of 65,536 characters, so such a line is no pull request command of this project. */
const MAX_COMMAND_LINE_CHARACTERS = 262_144
/** A file larger than this is skipped: it is no pull request text. Only regular files are read, so a device or a pipe is skipped too; the size is no promise about the time a scan takes. */
const MAX_TEXT_FILE_BYTES = 262_144
/** Matching lines named in a refusal; the others are counted in one more line. */
const MAX_REPORTED_MATCHES = 20
/** The characters of a matching line a refusal shows. */
const MAX_REPORTED_LINE_CHARACTERS = 200
/** How deep `( … )`, `$( … )` and `${ … }` may nest before the rest of the line is taken as one unknown word, so a hostile line cannot exhaust the stack. */
const MAX_NESTING_DEPTH = 32

/** The sentence that ends a refusal. */
const REFUSAL_FIX = `Write a non-closing reference such as \`Refs #N\` instead, or allow a deliberate closing reference by prefixing the command with \`${ALLOW_CLOSING_KEYWORD_ASSIGNMENT}\`.`

/** The name of an owner or a repository in `owner/repo#1` and in a GitHub URL; GitHub's own limits are lower, and the bound keeps a long run of name characters from being tried again at every keyword. */
const ISSUE_NAME = String.raw`[\w.-]{1,100}`
/**
 * A closing keyword of GitHub, then colons and spaces, then the Issue it names: `#123`, `owner/repo#123`, or the URL of an Issue or pull request on github.com.
 * The keyword stands at a word boundary, so `unclosed #5` and `fixed-width #5` do not match, nor does a keyword without a number.
 * Every repeat is bounded, so no line, however long, takes more than a constant number of steps per character.
 */
const CLOSING_REFERENCE = new RegExp(
  String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[:\s]{0,100}` +
    String.raw`(?:#\d+|${ISSUE_NAME}/${ISSUE_NAME}#\d+|https?://(?:www\.)?github\.com/${ISSUE_NAME}/${ISSUE_NAME}/(?:issues|pull)/\d+)`,
  'i',
)

/** Which actions of `gh pr` write a pull request's text (`merge` writes the merge commit's subject and body). */
const GH_PULL_REQUEST_ACTIONS = new Set(['create', 'edit', 'merge'])
/** Which actions of `gstack-post` write a pull request's text. */
const GSTACK_POST_ACTIONS = new Set(['pr-body', 'pr-create', 'pr-title'])

/** The long options that carry pull request text, by the way they carry it: the text itself, or the file that holds it. */
const TEXT_OPTION_KINDS = new Map([
  ['--body', 'text'],
  ['--title', 'text'],
  ['--subject', 'text'],
  ['--body-file', 'file'],
  ['--title-file', 'file'],
])
/** The short options that carry pull request text (`-b TEXT`, `-bTEXT`, `-b=TEXT`). */
const SHORT_TEXT_OPTION_KINDS = new Map([
  ['-b', 'text'],
  ['-t', 'text'],
  ['-F', 'file'],
])

/** An assignment word of a command line: `NAME=value`. */
const ASSIGNMENT_WORD = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/
/** A variable the shell would expand: `$NAME`, `${NAME}`, or `${NAME:?…}`, `${NAME:-…}`, `${NAME:=…}`; every repeat is bounded. */
const VARIABLE_REFERENCE =
  /\$(?:\{([A-Za-z_]\w{0,127})(?::([-=?])([^}]{0,512}))?\}|([A-Za-z_]\w{0,127}))/g

/** The private-use code points the lexer puts into words for what a word cannot say in plain text; a command line that holds any of them has them replaced first. */
const LITERAL_DOLLAR = String.fromCodePoint(0xe002)
/** Stands in for a value nobody can know: the output of a command substitution this script does not read. */
const UNKNOWN_MARK = String.fromCodePoint(0xe003)
/** Encloses the number of a command substitution in the word that holds it. */
const SUBSTITUTION_START = String.fromCodePoint(0xe004)
const SUBSTITUTION_END = String.fromCodePoint(0xe005)
/** Finds the marks of command substitutions in a word. */
const SUBSTITUTION_PATTERN = new RegExp(
  `${SUBSTITUTION_START}(\\d{1,9})${SUBSTITUTION_END}`,
  'g',
)
/** Finds the code points above in a command line before it is read. */
const RESERVED_CODE_POINTS = new RegExp(
  `[${String.fromCodePoint(0xe000)}-${String.fromCodePoint(0xe0ff)}]`,
  'g',
)
/** What a reserved code point of the command line becomes. */
const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd)

/** The redirection operators, longest first, so `<<<` is not read as `<<` and `&>>` not as `&>`. */
const REDIRECTION_OPERATORS = [
  '<<<',
  '<<-',
  '&>>',
  '<<',
  '<&',
  '<>',
  '>>',
  '>&',
  '>|',
  '&>',
  '<',
  '>',
]
/** The values of a file option that name standard input rather than a file. */
const STANDARD_INPUT_PATHS = new Set(['-', '/dev/stdin', '/dev/fd/0'])
/** The redirections that feed standard input. */
const STANDARD_INPUT_OPERATORS = new Set(['<', '<<', '<<-', '<<<'])
/** The redirections that write a file. */
const OUTPUT_OPERATORS = new Set(['>', '>>', '>|', '&>', '&>>'])

/** Words that may stand before a command without being it: the shell's reserved words that start a command, and the programs that pass their environment on. */
const TRANSPARENT_WORDS = new Set([
  '!',
  '{',
  'if',
  'then',
  'elif',
  'else',
  'while',
  'until',
  'do',
  'time',
  'builtin',
  'command',
  'exec',
  'nohup',
  'sudo',
])
/** The options of `env` that take the next word as their value. */
const ENV_OPTIONS_WITH_VALUE = new Set([
  '-u',
  '--unset',
  '-C',
  '--chdir',
  '-S',
  '--split-string',
])
/** What a backslash stands for inside `$'…'`; an escape not listed stays as written. */
const ANSI_C_ESCAPES = new Map([
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['\\', '\\'],
  ["'", "'"],
  ['"', '"'],
])
/** A backslash escape inside backticks. */
const BACKTICK_ESCAPES = /\\([`\\$])/g
/** The number of a `pushd +N` or `-N`, which names a place in the directory stack. */
const DIRECTORY_STACK_INDEX = /^[+-]\d+$/

/** The directory of a scope that has none of its own: it is the enclosing scope's. */
const INHERITED = Symbol('inherited')
/** The value of a variable that `unset` removed in a scope. */
const UNSET = Symbol('unset')

/**
 * @typedef {object} Redirection
 * @property {string} operator - `<`, `<<`, `<<-`, `<<<`, `<&`, `<>`, `>`, `>>`, `>&`, `>|`, `&>` or `&>>`.
 * @property {string | undefined} fd - The descriptor written before the operator (`2` in `2>&1`); `undefined` when none.
 * @property {string} target - The word after the operator: a path, a descriptor (`1` in `2>&1`), the text of a here-string, or the delimiter of a heredoc.
 * @property {boolean} isQuoted - Whether the target had a quote or backslash in it. A quoted heredoc delimiter means the body is read as written.
 * @property {string | undefined} body - For a heredoc, everything it feeds to the command, each line ended by a line break; `undefined` when the command line ends before the body.
 */

/**
 * @typedef {object} Segment
 * @property {'segment'} type
 * @property {string[]} words - The words of one command, quotes removed; a `$` that a quote or backslash made plain is {@link LITERAL_DOLLAR}, and a command substitution is a mark that numbers its {@link Substitution}.
 * @property {Redirection[]} redirections - The redirections of the command, in the order written.
 * @property {string} followedBy - What ended the command: `;`, a line break, `&&`, `||`, `|`, `&`, or `''` for a closing parenthesis and the end of the line.
 */

/**
 * @typedef {{ type: 'enter' } | { type: 'leave' }} ScopeEvent
 */

/**
 * @typedef {object} Substitution
 * @property {Segment[]} segments - The commands directly inside the substitution; those of a nested one belong to that one.
 */

/**
 * @typedef {object} LexerState
 * @property {string} text - The command line.
 * @property {number} index - The next character to read.
 * @property {Array<Segment | ScopeEvent>} events - The commands in the order they run, with `enter` and `leave` around every group and substitution.
 * @property {Substitution[]} substitutions - The command substitutions found, by number.
 * @property {Array<{ redirection: Redirection, stripTabs: boolean }>} pendingHeredocs - The heredocs whose bodies start at the next line break.
 */

/**
 * @typedef {object} Scope
 * @property {Scope | undefined} parent - The scope this one was opened in.
 * @property {Map<string, string | symbol>} variables - The variables assigned in this scope; {@link UNSET} for one that `unset` removed.
 * @property {string | symbol | undefined} directory - The working directory of this scope: {@link INHERITED}, a path, or `undefined` when it is unknown.
 */

/**
 * @typedef {object} Evaluation
 * @property {Substitution[]} substitutions - The command substitutions of the line.
 * @property {Record<string, string | undefined>} environment - The environment variables are looked up in after the line's own.
 * @property {Map<string, Array<{ mode: 'overwrite' | 'append' | 'opaque', text: string | undefined }>>} writes - What earlier commands of the line wrote to each absolute path, in order.
 * @property {PullRequestCommand[]} commands - The pull request commands found so far.
 */

/**
 * @typedef {{ kind: 'text', text: string } | { kind: 'file', path: string, isOptional: boolean }} TextFragment
 */

/**
 * @typedef {object} PullRequestText
 * @property {string} option - The option as the command line wrote it (`--body-file`, `-b`, …).
 * @property {string} source - What a refusal names: the option for inline text, `<option> -` for standard input, else the absolute path.
 * @property {TextFragment[]} fragments - The text in order: text the command line holds, and files read from the disk. A file that is `isOptional` may be missing (a `>>` creates it).
 */

/**
 * @typedef {object} PullRequestCommand
 * @property {boolean} isClosingKeywordAllowed - Whether the command line assigned `CODEBOOK_ALLOW_CLOSING_KEYWORD=1` for this command.
 * @property {PullRequestText[]} texts - The texts of the command that can be known, in the order written.
 */

/**
 * Cuts a line to {@link MAX_REPORTED_LINE_CHARACTERS} characters around its match, marking each cut with `…`.
 *
 * Why: a body written as one long paragraph would fill the refusal, and a cut from the left could hide the very words that matched.
 * Called by {@link findClosingReferences} for every matching line.
 *
 * @param line - A line without surrounding whitespace.
 * @param matchIndex - Where the closing keyword starts in the line.
 * @returns The line itself when it is short enough; else a window of exactly {@link MAX_REPORTED_LINE_CHARACTERS} characters, `…` included, that starts 40 characters before the match when it can.
 *
 * @example
 * ```js
 * excerptAroundMatch('Closes #1', 0) // => 'Closes #1'
 * excerptAroundMatch(`${'x'.repeat(500)} Closes #1`, 501).length // => 200
 * ```
 */
function excerptAroundMatch(line, matchIndex) {
  if (line.length <= MAX_REPORTED_LINE_CHARACTERS) return line
  const lastStart = line.length - MAX_REPORTED_LINE_CHARACTERS
  const start = Math.min(Math.max(matchIndex - 40, 0), lastStart)
  const end = start + MAX_REPORTED_LINE_CHARACTERS
  const opening = start > 0 ? '…' : ''
  const closing = end < line.length ? '…' : ''
  return `${opening}${line.slice(start + opening.length, end - closing.length)}${closing}`
}

/**
 * Finds the lines of a text that put a closing keyword right before an Issue reference.
 *
 * Why: this is the rule of Issue #98 in one place, so the hook and its tests apply the same pattern.
 * Called by {@link listClosingKeywordRefusals} for every pull request text it reads.
 *
 * @param text - A pull request title or description; lines end with `\n`, `\r\n` or `\r`.
 * @returns One entry per matching line, in order: the 1-based line number and the line without surrounding whitespace, cut around its match to 200 characters when longer (see {@link excerptAroundMatch}). Empty when no line matches.
 *
 * @example
 * ```js
 * findClosingReferences('Refs #12\n  Close #90 after the merge.\nunclosed #5')
 * // => [{ lineNumber: 2, lineText: 'Close #90 after the merge.' }]
 * ```
 */
export function findClosingReferences(text) {
  return text.split(/\r\n|\r|\n/).flatMap((line, index) => {
    const trimmed = line.trim()
    const match = CLOSING_REFERENCE.exec(trimmed)
    return match === null
      ? []
      : [
          {
            lineNumber: index + 1,
            lineText: excerptAroundMatch(trimmed, match.index),
          },
        ]
  })
}

/**
 * Reads a single-quoted string, which keeps every character up to the next single quote.
 *
 * Called by {@link lexCommands} at a single quote outside any other quote.
 *
 * @param state - The lexer, with `index` at the opening quote; it moves past the closing quote (the end of the line when the quote is not closed).
 * @returns The text between the quotes, with every `$` made plain ({@link LITERAL_DOLLAR}).
 *
 * @example
 * ```js
 * // state.text = "a 'b $c' d", state.index = 2
 * readSingleQuoted(state) // => `b ${LITERAL_DOLLAR}c`, and state.index is 8
 * ```
 */
function readSingleQuoted(state) {
  const closingIndex = state.text.indexOf("'", state.index + 1)
  const endIndex = closingIndex === -1 ? state.text.length : closingIndex
  const content = state.text.slice(state.index + 1, endIndex)
  state.index = Math.min(endIndex + 1, state.text.length)
  return content.replaceAll('$', LITERAL_DOLLAR)
}

/**
 * Reads an ANSI-C string, `$'…'`: a backslash stands for a line break (`\n`), a tab (`\t`), `\r`, `\\`, `\'` or `\"`; any other escape stays as written.
 *
 * Why: `--body $'Intro\nCloses #1'` has two lines, and the second names the Issue.
 * Called by {@link lexCommands} at `$'`.
 *
 * @param state - The lexer, with `index` at the `$`; it moves past the closing quote.
 * @returns The decoded text, with every `$` made plain ({@link LITERAL_DOLLAR}).
 *
 * @example
 * ```js
 * // state.text = "$'a\\nb'", state.index = 0
 * readAnsiCQuoted(state) // => 'a\nb'
 * ```
 */
function readAnsiCQuoted(state) {
  const { text } = state
  let value = ''
  state.index += 2
  while (state.index < text.length && text[state.index] !== "'") {
    const decoded =
      text[state.index] === '\\'
        ? ANSI_C_ESCAPES.get(text[state.index + 1])
        : undefined
    if (decoded === undefined) {
      value += text[state.index] === '$' ? LITERAL_DOLLAR : text[state.index]
      state.index += 1
    } else {
      value += decoded
      state.index += 2
    }
  }
  state.index = Math.min(state.index + 1, text.length)
  return value
}

/**
 * Reads a double-quoted string: a backslash escapes only `$`, a backtick, `"` and `\`, and joins a line break to the next line; `$( … )`, `${ … }` and backticks inside stay part of the string, quotes of their own included.
 *
 * Why: `--title "$(echo "a b; c")"` is one word; ending the string at the inner quote would cut the command and lose the options after it.
 * Called by {@link lexCommands} at a double quote outside any other quote.
 *
 * @param state - The lexer, with `index` at the opening quote; it moves past the closing quote.
 * @param depth - How deep the lexer is nested.
 * @returns The text between the quotes: escapes resolved, `$` that a backslash made plain as {@link LITERAL_DOLLAR}, a command substitution as its mark.
 *
 * @example
 * ```js
 * // state.text = 'x "say \\"hi\\"" y', state.index = 2
 * readDoubleQuoted(state, 0) // => 'say "hi"'
 * ```
 */
function readDoubleQuoted(state, depth) {
  const { text } = state
  let value = ''
  state.index += 1
  while (state.index < text.length && text[state.index] !== '"') {
    const character = text[state.index]
    const next = text[state.index + 1]
    if (character === '\\' && next === '\n') {
      // A backslash before a line break joins the lines.
      state.index += 2
    } else if (character === '\\' && next === '$') {
      value += LITERAL_DOLLAR
      state.index += 2
    } else if (
      character === '\\' &&
      (next === '`' || next === '"' || next === '\\')
    ) {
      value += next
      state.index += 2
    } else if (character === '$' && next === '(') {
      state.index += 2
      value += readSubstitution(state, depth)
    } else if (character === '$' && next === '{') {
      value += readBraced(state, depth)
    } else if (character === '`') {
      value += readBackticks(state, depth)
    } else {
      value += character
      state.index += 1
    }
  }
  state.index = Math.min(state.index + 1, text.length)
  return value
}

/**
 * Reads a parameter expansion, `${ … }`, whole: nested `${ … }`, quotes and escapes inside do not end it.
 *
 * Called by {@link lexCommands} and {@link readDoubleQuoted} at `${`.
 *
 * @param state - The lexer, with `index` at the `$`; it moves past the closing brace (the end of the line when there is none).
 * @param depth - How deep the lexer is nested.
 * @returns The text as written, for {@link expandVariables} to expand; {@link UNKNOWN_MARK} when it holds a command substitution.
 *
 * @example
 * ```js
 * // state.text = '${A:-"x y"} z', state.index = 0
 * readBraced(state, 0) // => '${A:-"x y"}', and state.index is 12
 * ```
 */
function readBraced(state, depth) {
  const { text } = state
  const startIndex = state.index
  let openBraces = 0
  let hasSubstitution = false
  while (state.index < text.length) {
    const character = text[state.index]
    const next = text[state.index + 1]
    if (character === '$' && next === '{') {
      openBraces += 1
      state.index += 2
    } else if (character === '}') {
      state.index += 1
      openBraces -= 1
      if (openBraces === 0) break
    } else if (character === '\\') {
      state.index += 2
    } else if (character === "'") {
      const closingIndex = text.indexOf("'", state.index + 1)
      state.index = closingIndex === -1 ? text.length : closingIndex + 1
    } else if (character === '"') {
      state.index += 1
      while (state.index < text.length && text[state.index] !== '"')
        state.index += text[state.index] === '\\' ? 2 : 1
      state.index += 1
    } else if (character === '$' && next === '(') {
      state.index += 2
      readSubstitution(state, depth)
      hasSubstitution = true
    } else if (character === '`') {
      readBackticks(state, depth)
      hasSubstitution = true
    } else {
      state.index += 1
    }
  }
  state.index = Math.min(state.index, text.length)
  return hasSubstitution ? UNKNOWN_MARK : text.slice(startIndex, state.index)
}

/**
 * Lexes a command substitution into the lexer's events and records it.
 *
 * Why: the commands inside a substitution run before the command that holds it, in a subshell of their own, and may themselves be pull request commands; the substitution's value is known only for a few shapes ({@link evaluateSubstitution}).
 * Called by {@link readSubstitution} and {@link readBackticks}.
 *
 * @param state - The lexer that receives the events and the substitution.
 * @param lexInner - Lexes the inside of the substitution, from its first character to its end.
 * @returns The mark that stands for the substitution in the word that holds it.
 *
 * @example
 * ```js
 * lexSubstitution(state, () => lexCommands(state, 1, true)) // => `${SUBSTITUTION_START}0${SUBSTITUTION_END}`
 * ```
 */
function lexSubstitution(state, lexInner) {
  state.events.push({ type: 'enter' })
  const innerStart = state.events.length
  lexInner()
  const segments = directSegments(state.events.slice(innerStart))
  state.events.push({ type: 'leave' })
  state.substitutions.push({ segments })
  return `${SUBSTITUTION_START}${state.substitutions.length - 1}${SUBSTITUTION_END}`
}

/**
 * Picks the commands that stand directly in a list of events, not those of a group or substitution inside it.
 *
 * Called by {@link lexSubstitution}.
 *
 * @param events - The events of one substitution.
 * @returns The segments at nesting depth 0, in order.
 *
 * @example
 * ```js
 * directSegments([a, { type: 'enter' }, b, { type: 'leave' }, c]) // => [a, c]
 * ```
 */
function directSegments(events) {
  let nesting = 0
  const segments = []
  for (const event of events) {
    if (event.type === 'enter') nesting += 1
    else if (event.type === 'leave') nesting -= 1
    else if (nesting === 0) segments.push(event)
  }
  return segments
}

/**
 * Reads a command substitution, `$( … )` or `<( … )`, from the character after its opening parenthesis to its closing one.
 *
 * Called by {@link lexCommands}, {@link readDoubleQuoted} and {@link readBraced}.
 *
 * @param state - The lexer, with `index` after the opening parenthesis; it moves past the closing one.
 * @param depth - How deep the lexer is nested.
 * @returns The mark that stands for the substitution; {@link UNKNOWN_MARK}, with the rest of the line taken, when the nesting is deeper than {@link MAX_NESTING_DEPTH}.
 *
 * @example
 * ```js
 * // state.text = '$(cat <<EOF\nbody\nEOF\n)', state.index = 2
 * readSubstitution(state, 0) // => the mark of substitution 0, whose one segment is `cat` with a heredoc
 * ```
 */
function readSubstitution(state, depth) {
  if (depth >= MAX_NESTING_DEPTH) {
    state.index = state.text.length
    return UNKNOWN_MARK
  }
  return lexSubstitution(state, () => {
    lexCommands(state, depth + 1, true)
  })
}

/**
 * Reads a backtick substitution up to the next backtick and lexes what is inside as a command line of its own.
 *
 * Called by {@link lexCommands}, {@link readDoubleQuoted} and {@link readBraced}.
 *
 * @param state - The lexer, with `index` at the opening backtick; it moves past the closing one.
 * @param depth - How deep the lexer is nested.
 * @returns The mark that stands for the substitution; {@link UNKNOWN_MARK} when the nesting is too deep.
 *
 * @example
 * ```js
 * // state.text = '`pwd`', state.index = 0
 * readBackticks(state, 0) // => the mark of substitution 0, whose one segment is `pwd`
 * ```
 */
function readBackticks(state, depth) {
  const { text } = state
  let endIndex = state.index + 1
  while (endIndex < text.length && text[endIndex] !== '`')
    endIndex += text[endIndex] === '\\' ? 2 : 1
  const inner = text
    .slice(state.index + 1, endIndex)
    .replace(BACKTICK_ESCAPES, '$1')
  state.index = Math.min(endIndex + 1, text.length)
  if (depth >= MAX_NESTING_DEPTH) return UNKNOWN_MARK
  const innerState = {
    text: inner,
    index: 0,
    events: state.events,
    substitutions: state.substitutions,
    pendingHeredocs: [],
  }
  return lexSubstitution(state, () => {
    lexCommands(innerState, depth + 1, false)
  })
}

/**
 * Reads the redirection operator at the lexer's index, the longest one.
 *
 * Called by {@link lexCommands} at `<`, `>` or `&>`.
 *
 * @param state - The lexer, with `index` at the operator; it moves past it.
 * @returns The operator, one of {@link REDIRECTION_OPERATORS}.
 *
 * @example
 * ```js
 * // state.text = '2>&1', state.index = 1
 * readRedirectionOperator(state) // => '>&'
 * ```
 */
function readRedirectionOperator(state) {
  const operator = REDIRECTION_OPERATORS.find((candidate) =>
    state.text.startsWith(candidate, state.index),
  )
  state.index += operator.length
  return operator
}

/**
 * Reads the bodies of the heredocs that the line just ended opened, the way a shell does: each runs up to a line that is its delimiter.
 *
 * Why: a heredoc body is free text (`it's`, an open quote or parenthesis, a line that looks like a command) and must neither end a quote early nor run as commands, yet it belongs to the command whose line opened it.
 * Called by {@link lexCommands} at every line break outside a quote.
 *
 * @param state - The lexer, with `index` at the first character after the line break; it moves past the delimiter line of the last heredoc. Each heredoc's `body` is set; one without a delimiter line takes the rest of the command line, as a shell does.
 *
 * @example
 * ```js
 * // state.text = 'cat <<EOF\nit\'s\nEOF\nls', after the first line break, with one pending heredoc
 * readHeredocBodies(state) // sets the body to "it's\n", and state.index is at "ls"
 * ```
 */
function readHeredocBodies(state) {
  for (const { redirection, stripTabs } of state.pendingHeredocs.splice(0)) {
    const lines = []
    while (state.index < state.text.length) {
      const lineEnd = state.text.indexOf('\n', state.index)
      const endIndex = lineEnd === -1 ? state.text.length : lineEnd
      const line = state.text.slice(state.index, endIndex)
      state.index = lineEnd === -1 ? state.text.length : lineEnd + 1
      // `<<-` lets tabs stand before the delimiter and the lines.
      const content = stripTabs ? line.replace(/^\t+/, '') : line
      if (content === redirection.target) break
      lines.push(content)
    }
    redirection.body = lines.map((line) => `${line}\n`).join('')
  }
}

/**
 * Lexes commands into segments, as a shell reads them: words with their quotes resolved, redirections apart from the words, and a command ends at `&&`, `||`, `;`, `|`, `&`, a line break or a parenthesis.
 *
 * Why: the hook must tell the words of a pull request command (`--body-file`, a path, a quoted text) from the text around it, and what a heredoc, a redirection or a group changes for the commands after it; a pattern over the raw line would also match a commit message that mentions `gh pr create`.
 * Called by {@link splitCommandSegments}, {@link readSubstitution} and {@link readBackticks}.
 *
 * Single quotes keep everything; double quotes resolve `\"`, `\\`, `\$`, `` \` `` and a backslash before a line break; a backslash outside quotes keeps the next character; `#` at the start of a word begins a comment; `$'…'` is decoded. A redirection takes the next word as its operand, a digit word right before it as its descriptor. `( … )` is a group (`enter` and `leave` around its commands), `$( … )` and backticks a substitution.
 *
 * @param state - The lexer; it moves to the end of the line, or past the `)` that closes the substitution.
 * @param depth - How deep the lexer is nested; a group deeper than {@link MAX_NESTING_DEPTH} is read as a plain separator.
 * @param isInsideSubstitution - Whether an unmatched `)` ends this call (the substitution's closing parenthesis).
 *
 * @example
 * ```js
 * // state.text = 'cat > p.md <<EOF\nCloses #1\nEOF'
 * lexCommands(state, 0, false)
 * // state.events is [{ type: 'segment', words: ['cat'], redirections: [>, p.md and << EOF with body 'Closes #1\n'], followedBy: '\n' }]
 * ```
 */
function lexCommands(state, depth, isInsideSubstitution) {
  const { text } = state
  let words = []
  let redirections = []
  let word = ''
  // True once a word has begun, so an empty quoted string ('' or "") still makes a word.
  let isInWord = false
  let isQuoted = false
  let pendingOperator
  let openGroups = 0
  let ignoredGroups = 0

  /** Closes the word being read: it is the operand of a pending redirection, or a word of the command. */
  const endWord = () => {
    if (isInWord && pendingOperator === undefined) {
      words.push(word)
    } else if (isInWord) {
      const redirection = {
        operator: pendingOperator.operator,
        fd: pendingOperator.fd,
        target: word,
        isQuoted,
        body: undefined,
      }
      redirections.push(redirection)
      if (redirection.operator === '<<' || redirection.operator === '<<-')
        state.pendingHeredocs.push({
          redirection,
          stripTabs: redirection.operator === '<<-',
        })
      pendingOperator = undefined
    }
    word = ''
    isInWord = false
    isQuoted = false
  }
  /** Closes the command being read, if it has a word or a redirection. */
  const endCommand = (followedBy) => {
    endWord()
    pendingOperator = undefined
    if (words.length > 0 || redirections.length > 0)
      state.events.push({ type: 'segment', words, redirections, followedBy })
    words = []
    redirections = []
  }

  while (state.index < text.length) {
    const character = text[state.index]
    const next = text[state.index + 1]
    if (character === "'") {
      word += readSingleQuoted(state)
      isInWord = true
      isQuoted = true
    } else if (character === '"') {
      word += readDoubleQuoted(state, depth)
      isInWord = true
      isQuoted = true
    } else if (character === '\\') {
      // A backslash keeps the next character as it is; before a line break it joins the lines.
      if (next !== undefined && next !== '\n') {
        word += next === '$' ? LITERAL_DOLLAR : next
        isInWord = true
        isQuoted = true
      }
      state.index += 2
    } else if (character === '$' && next === '(') {
      state.index += 2
      word += readSubstitution(state, depth)
      isInWord = true
    } else if (character === '$' && next === "'") {
      word += readAnsiCQuoted(state)
      isInWord = true
      isQuoted = true
    } else if (character === '$' && next === '{') {
      word += readBraced(state, depth)
      isInWord = true
    } else if (character === '`') {
      word += readBackticks(state, depth)
      isInWord = true
    } else if (character === '#' && !isInWord) {
      // A comment runs to the end of its line; the line break itself still ends the command.
      const lineEnd = text.indexOf('\n', state.index)
      state.index = lineEnd === -1 ? text.length : lineEnd
    } else if (character === '\n') {
      endCommand('\n')
      state.index += 1
      readHeredocBodies(state)
    } else if (character === ';') {
      endCommand(';')
      state.index += 1
    } else if (character === '&' && next === '&') {
      endCommand('&&')
      state.index += 2
    } else if (
      character === '<' ||
      character === '>' ||
      (character === '&' && next === '>')
    ) {
      if (next === '(' && character !== '&') {
        // Process substitution, <( … ) or >( … ): a file name whose content nobody can know.
        state.index += 2
        word += readSubstitution(state, depth)
        isInWord = true
      } else {
        // A word of digits right before the operator is the descriptor it applies to (`2>&1`).
        let fd
        if (isInWord && !isQuoted && /^\d{1,3}$/.test(word)) {
          fd = word
          word = ''
          isInWord = false
        } else {
          endWord()
        }
        pendingOperator = { operator: readRedirectionOperator(state), fd }
      }
    } else if (character === '&') {
      // A single & runs the command in the background; `>&`, `<&` and `&>` were read as operators above.
      endCommand('&')
      state.index += 1
    } else if (character === '|') {
      endCommand(next === '|' ? '||' : '|')
      state.index += next === '|' || next === '&' ? 2 : 1
    } else if (character === '(') {
      endCommand(';')
      state.index += 1
      if (depth + openGroups + ignoredGroups < MAX_NESTING_DEPTH) {
        state.events.push({ type: 'enter' })
        openGroups += 1
      } else {
        ignoredGroups += 1
      }
    } else if (character === ')') {
      state.index += 1
      if (ignoredGroups > 0) {
        ignoredGroups -= 1
        endCommand(';')
      } else if (openGroups > 0) {
        endCommand('')
        state.events.push({ type: 'leave' })
        openGroups -= 1
      } else if (isInsideSubstitution) {
        endCommand('')
        return
      } else {
        endCommand(';')
      }
    } else if (/\s/.test(character)) {
      endWord()
      state.index += 1
    } else {
      word += character
      isInWord = true
      state.index += 1
    }
  }
  endCommand('')
  // A group that the line never closed ends with the line.
  for (; openGroups > 0; openGroups -= 1) state.events.push({ type: 'leave' })
}

/**
 * Splits a command line into the commands a shell would run, in order, with the groups and substitutions they sit in.
 *
 * Why: the first step of reading a Bash command; see {@link lexCommands} for the rules.
 * Called by {@link findPullRequestCommands}; the tests call it for the lexer's own rules.
 *
 * @param commandLine - The command line as the Bash tool received it.
 * @returns `events`: the segments in the order they run, with `enter` and `leave` around the commands of every `( … )` group and substitution; `substitutions`: the command substitutions by the number their mark carries. The body of a heredoc belongs to the segment whose line opened it and appears nowhere else.
 *
 * @example
 * ```js
 * splitCommandSegments('gh pr edit 12 --body "a b" && git status | cat').events.map((event) => event.words)
 * // => [['gh', 'pr', 'edit', '12', '--body', 'a b'], ['git', 'status'], ['cat']]
 * ```
 */
export function splitCommandSegments(commandLine) {
  const state = {
    text: commandLine.replace(RESERVED_CODE_POINTS, REPLACEMENT_CHARACTER),
    index: 0,
    events: [],
    substitutions: [],
    pendingHeredocs: [],
  }
  lexCommands(state, 0, false)
  return { events: state.events, substitutions: state.substitutions }
}

/**
 * Opens a scope: the variables and working directory a group, a substitution or a command that runs in a subshell changes for itself.
 *
 * Called by {@link findPullRequestCommands}.
 *
 * @param parent - The scope it is opened in; `undefined` for the line's own.
 * @param directory - The working directory it starts with; by default the parent's.
 * @returns A scope with no variables of its own.
 *
 * @example
 * ```js
 * const scope = createScope(undefined, '/repo')
 * createScope(scope) // sees /repo and the variables of scope; what it sets is gone with it
 * ```
 */
function createScope(parent, directory = INHERITED) {
  return { parent, variables: new Map(), directory }
}

/**
 * Gives the working directory a scope sees.
 *
 * Called by {@link lookupVariable}, {@link resolvePath} and {@link evaluateSubstitution}.
 *
 * @param scope - The scope to look in.
 * @returns The nearest directory set from this scope outwards; `undefined` when a `cd` made it unknown.
 *
 * @example
 * ```js
 * directoryOf(createScope(createScope(undefined, '/repo'))) // => '/repo'
 * ```
 */
function directoryOf(scope) {
  for (let current = scope; current !== undefined; current = current.parent)
    if (current.directory !== INHERITED) return current.directory
  return undefined
}

/**
 * Reads a variable the command line itself assigned, from this scope outwards.
 *
 * Called by {@link lookupVariable} and {@link describePullRequestCommand}.
 *
 * @param scope - The scope to start in.
 * @param name - The variable's name.
 * @returns The value; {@link UNSET} when `unset` removed it; `undefined` when the line never assigned it.
 *
 * @example
 * ```js
 * readScopeVariable(scope, 'A') // => '1' after `A=1`
 * ```
 */
function readScopeVariable(scope, name) {
  for (let current = scope; current !== undefined; current = current.parent)
    if (current.variables.has(name)) return current.variables.get(name)
  return undefined
}

/**
 * Looks a variable up where the shell would find it: the command line's own assignments first, then the environment.
 *
 * Called by {@link expandVariables}.
 *
 * @param name - The variable's name.
 * @param scope - The scope the word is in.
 * @param environment - The environment of the hook, which the Bash tool's shell inherits for the most part.
 * @returns The value; `undefined` when `unset` removed it or neither knows it. `PWD` is the line's working directory, not the hook's; `OLDPWD` is unknown, as the shell keeps it and the hook's copy belongs to another shell.
 *
 * @example
 * ```js
 * lookupVariable('B', createScope(undefined, '/repo'), { B: '2' }) // => '2'
 * lookupVariable('PWD', createScope(undefined, '/repo'), {})       // => '/repo'
 * ```
 */
function lookupVariable(name, scope, environment) {
  const assigned = readScopeVariable(scope, name)
  if (assigned === UNSET) return undefined
  if (assigned !== undefined) return assigned
  if (name === 'PWD') return directoryOf(scope) ?? UNKNOWN_MARK
  if (name === 'OLDPWD') return UNKNOWN_MARK
  return Object.hasOwn(environment, name) ? environment[name] : undefined
}

/**
 * Expands the variables of a word that the shell would expand and this script knows.
 *
 * Why: the `/ship` template hands its files over as `--title-file "$TITLE_FILE"` and `--body-file "${PR_BODY_FILE:?…}"`, so a hook that read only literal paths would skip the very flow Issue #98 guards.
 * Called by {@link expandWord} and {@link readInputText}.
 *
 * @param text - A word, or a heredoc body whose delimiter was not quoted.
 * @param scope - The scope the text is in.
 * @param environment - The environment to fall back on.
 * @returns The text with `$NAME`, `${NAME}`, `${NAME:?…}`, `${NAME:-…}` and `${NAME:=…}` replaced by the value, or by the default of `:-` and `:=` when the variable is unset or empty. A variable nobody knows stays as it is, so a path made from it cannot be read and is skipped.
 *
 * @example
 * ```js
 * expandVariables('${BODY:?restore it}/b.md', scopeWith('BODY', '/tmp'), {}) // => '/tmp/b.md'
 * expandVariables('$UNKNOWN/b.md', createScope(undefined, '/'), {})           // => '$UNKNOWN/b.md'
 * ```
 */
function expandVariables(text, scope, environment) {
  return text.replace(
    VARIABLE_REFERENCE,
    (reference, bracedName, operator, operand, bareName) => {
      const value = lookupVariable(bracedName ?? bareName, scope, environment)
      if (value !== undefined && value !== '') return value
      // `${NAME:-default}` and `${NAME:=default}` give the default; `${NAME:?…}` and a bare name stay unresolved.
      return operator === '-' || operator === '=' ? operand : reference
    },
  )
}

/**
 * Finds the top folder of the repository that holds a folder, the way `git rev-parse --show-toplevel` would.
 *
 * Called by {@link evaluateSubstitution}.
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
 * Removes the line breaks at the end of a text, as a command substitution does with its output.
 *
 * Called by {@link evaluateSubstitution}.
 *
 * @param text - The output of a command.
 * @returns The text without its trailing line breaks.
 *
 * @example
 * ```js
 * trimTrailingLineBreaks('Closes #1\n\n') // => 'Closes #1'
 * ```
 */
function trimTrailingLineBreaks(text) {
  let endIndex = text.length
  while (endIndex > 0 && text[endIndex - 1] === '\n') endIndex -= 1
  return text.slice(0, endIndex)
}

/**
 * Reads the text a heredoc or here-string feeds to a command.
 *
 * Called by {@link evaluateSubstitution}, {@link recordWrites} and {@link resolveStandardInput}.
 *
 * @param redirection - A `<<`, `<<-` or `<<<` redirection.
 * @param scope - The scope the command is in.
 * @param evaluation - The evaluation state.
 * @returns What the command reads, each line ended by a line break. A heredoc is read as written when its delimiter was quoted, else with the line's variables expanded. `undefined` when the command line ends before the heredoc's body.
 *
 * @example
 * ```js
 * readInputText({ operator: '<<<', target: 'Closes #1', isQuoted: true, fd: undefined, body: undefined }, scope, evaluation)
 * // => 'Closes #1\n'
 * ```
 */
function readInputText(redirection, scope, evaluation) {
  if (redirection.operator === '<<<')
    return `${expandWord(redirection.target, scope, evaluation)}\n`
  if (redirection.body === undefined) return undefined
  return redirection.isQuoted
    ? redirection.body
    : expandVariables(redirection.body, scope, evaluation.environment)
}

/**
 * Finds what feeds standard input of a command.
 *
 * Called by {@link evaluateSubstitution}, {@link recordWrites} and {@link resolveStandardInput}.
 *
 * @param redirections - The redirections of one command.
 * @returns The last redirection of descriptor 0 (`<`, `<<`, `<<-`, `<<<`), as the shell lets the last one win; `undefined` when none (the input is a terminal or a pipe).
 *
 * @example
 * ```js
 * findStandardInput(lexedRedirections('cat < a <<EOF')) // => the << redirection
 * ```
 */
function findStandardInput(redirections) {
  return redirections.findLast(
    (redirection) =>
      STANDARD_INPUT_OPERATORS.has(redirection.operator) &&
      (redirection.fd === undefined || redirection.fd === '0'),
  )
}

/**
 * Gives the value of a command substitution when this script can know it.
 *
 * Why: a value made of an unknown output must be skipped, not read as the text of the command that made it; only these three shapes are known.
 * Called by {@link expandWord}.
 *
 * @param substitution - The substitution a mark in a word numbers; `undefined` when the mark has no entry.
 * @param scope - The scope the word is in.
 * @param evaluation - The evaluation state.
 * @returns For `$(cat <<'EOF' … EOF)` the heredoc without its trailing line breaks; for `$(pwd)` the line's working directory; for `$(git rev-parse --show-toplevel)`, also with `2>/dev/null` and `|| pwd`, the repository's top folder. Anything else, and any of these when the directory is unknown: {@link UNKNOWN_MARK}.
 *
 * @example
 * ```js
 * // `$(git rev-parse --show-toplevel 2>/dev/null || pwd)` in /repo/extension, where /repo has a .git
 * evaluateSubstitution(substitution, scope, evaluation) // => '/repo'
 * ```
 */
function evaluateSubstitution(substitution, scope, evaluation) {
  const [first, second, third] = substitution?.segments ?? []
  if (first === undefined || third !== undefined) return UNKNOWN_MARK
  const command = first.words.join(' ')
  if (command === 'cat' && second === undefined) {
    const input = findStandardInput(first.redirections)
    const text =
      input === undefined || input.operator === '<'
        ? undefined
        : readInputText(input, scope, evaluation)
    return text === undefined ? UNKNOWN_MARK : trimTrailingLineBreaks(text)
  }
  if (command === 'pwd' && second === undefined)
    return directoryOf(scope) ?? UNKNOWN_MARK
  const isGitRoot =
    command === 'git rev-parse --show-toplevel' &&
    (second === undefined ||
      (first.followedBy === '||' && second.words.join(' ') === 'pwd'))
  const directory = directoryOf(scope)
  return isGitRoot && directory !== undefined
    ? findRepositoryRoot(directory)
    : UNKNOWN_MARK
}

/**
 * Expands a word as the shell would, as far as this script knows how: variables first, then command substitutions.
 *
 * Called by {@link readInputText}, {@link assignWords}, {@link changeDirectory}, {@link recordWrites}, {@link resolveStandardInput}, {@link describePullRequestCommand}.
 *
 * @param word - A word of a command, with its marks.
 * @param scope - The scope the word is in.
 * @param evaluation - The evaluation state.
 * @returns The expanded text. A value nobody knows is {@link UNKNOWN_MARK} in it; a `$` that a quote made plain is still {@link LITERAL_DOLLAR}. Variables go first, so a value that a substitution brings is never expanded again.
 *
 * @example
 * ```js
 * expandWord(`$DIR/${SUBSTITUTION_START}0${SUBSTITUTION_END}`, scope, evaluation) // => '/tmp/' followed by the value of substitution 0
 * ```
 */
function expandWord(word, scope, evaluation) {
  return expandVariables(word, scope, evaluation.environment).replace(
    SUBSTITUTION_PATTERN,
    (_mark, substitutionNumber) =>
      evaluateSubstitution(
        evaluation.substitutions[Number(substitutionNumber)],
        scope,
        evaluation,
      ),
  )
}

/**
 * Turns the plain dollar signs of a text back into `$`.
 *
 * Called by {@link resolvePath}, {@link recordWrites}, {@link resolveTextOption} and {@link resolveStandardInput}.
 *
 * @param text - Expanded text.
 * @returns The text a command receives, with {@link LITERAL_DOLLAR} as `$`.
 *
 * @example
 * ```js
 * finalize(`costs ${LITERAL_DOLLAR}5`) // => 'costs $5'
 * ```
 */
function finalize(text) {
  return text.replaceAll(LITERAL_DOLLAR, '$')
}

/**
 * Expands a leading `~` to the home folder.
 *
 * Called by {@link resolvePath}.
 *
 * @param path - A path as the command wrote it.
 * @param environment - Where `HOME` is looked up first; then the account's home.
 * @returns The path with `~` or `~/` replaced; `undefined` for `~name`, whose home this script does not look up.
 *
 * @example
 * ```js
 * expandTilde('~/notes/b.md', { HOME: '/home/me' }) // => '/home/me/notes/b.md'
 * expandTilde('~bob/b.md', {})                      // => undefined
 * ```
 */
function expandTilde(path, environment) {
  if (path !== '~' && !path.startsWith('~/'))
    return path.startsWith('~') ? undefined : path
  const home =
    Object.hasOwn(environment, 'HOME') && environment.HOME
      ? environment.HOME
      : homedir()
  return `${home}${path.slice(1)}`
}

/**
 * Turns an expanded path into the absolute path a command would use from where it runs.
 *
 * Why: a relative path starts at the working directory that the line has reached by then, not at the hook's own.
 * Called by {@link changeDirectory}, {@link recordWrites} and {@link resolveFileText}.
 *
 * @param expanded - The path after {@link expandWord}.
 * @param scope - The scope the path is in, for its working directory.
 * @param environment - The environment for `~`.
 * @returns The absolute path; `undefined` when it holds an unknown part or a variable nobody assigned, is `~name`, or is relative while the directory is unknown.
 *
 * @example
 * ```js
 * resolvePath('b.md', createScope(undefined, '/repo'), {}) // => '/repo/b.md'
 * resolvePath('b.md', scopeWithUnknownDirectory, {})       // => undefined
 * ```
 */
function resolvePath(expanded, scope, environment) {
  // A `$` left after expansion is a reference nobody could resolve.
  if (expanded.includes(UNKNOWN_MARK) || expanded.includes('$'))
    return undefined
  const path = expandTilde(finalize(expanded), environment)
  if (path === undefined) return undefined
  if (isAbsolute(path)) return resolve(path)
  const directory = directoryOf(scope)
  return directory === undefined ? undefined : resolve(directory, path)
}

/**
 * Sets the variables of the `NAME=value` words in the scope.
 *
 * Called by {@link applyShellEffects}.
 *
 * @param words - Words of a command; those that are no assignment are passed over.
 * @param scope - The scope that receives the variables.
 * @param evaluation - The evaluation state, for the expansion of the values.
 *
 * @example
 * ```js
 * assignWords(['A=/tmp', 'B=$A/x'], scope, evaluation) // scope now has A=/tmp and B=/tmp/x
 * ```
 */
function assignWords(words, scope, evaluation) {
  for (const word of words) {
    const assignment = ASSIGNMENT_WORD.exec(word)
    if (assignment !== null)
      scope.variables.set(
        assignment[1],
        expandWord(assignment[2], scope, evaluation),
      )
  }
}

/**
 * Reads what stands before a command: reserved words and wrappers, `NAME=value` words, and `env` with its options and assignments.
 *
 * Why: only assignments in this position reach the command; `echo CODEBOOK_ALLOW_CLOSING_KEYWORD=1 gh pr edit …` assigns nothing.
 * Called by {@link evaluateSegment}.
 *
 * @param words - The words of one command.
 * @returns `assignments`: the `NAME=value` words that precede the command; `commandIndex`: the index of the first word that is neither of these, `words.length` when none.
 *
 * @example
 * ```js
 * readCommandPrefix(['A=1', 'env', '-u', 'B', 'C=2', 'gh', 'pr']) // => { assignments: ['A=1', 'C=2'], commandIndex: 5 }
 * ```
 */
function readCommandPrefix(words) {
  const assignments = []
  let index = 0
  while (index < words.length) {
    const word = words[index]
    if (TRANSPARENT_WORDS.has(word)) {
      index += 1
    } else if (ASSIGNMENT_WORD.test(word)) {
      assignments.push(word)
      index += 1
    } else if (basename(word) === 'env') {
      index += 1
      while (index < words.length) {
        const envWord = words[index]
        if (ASSIGNMENT_WORD.test(envWord)) {
          assignments.push(envWord)
          index += 1
        } else if (ENV_OPTIONS_WITH_VALUE.has(envWord)) {
          index += 2
        } else if (envWord.startsWith('-') && envWord !== '-') {
          index += 1
        } else {
          break
        }
      }
    } else {
      break
    }
  }
  return { assignments, commandIndex: Math.min(index, words.length) }
}

/**
 * Finds where a command of a pull request starts in the words of one command.
 *
 * Called by {@link evaluateSegment}.
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
 * Reads one word as a text option of a pull request command.
 *
 * Called by {@link readTextOptions}.
 *
 * @param word - An expanded word after the command's action.
 * @returns `option` as written, its `kind` (`text` or `file`), and `attachedValue` when the word carries the value itself: `--name=value`, `-bTEXT`, `-b=TEXT`. `undefined` for a word that is no text option.
 *
 * @example
 * ```js
 * parseTextOption('--title-file=t.md') // => { option: '--title-file', kind: 'file', attachedValue: 't.md' }
 * parseTextOption('-bRefs #1')         // => { option: '-b', kind: 'text', attachedValue: 'Refs #1' }
 * parseTextOption('--base')            // => undefined
 * ```
 */
function parseTextOption(word) {
  if (word.startsWith('--')) {
    const equalsIndex = word.indexOf('=')
    const option = equalsIndex === -1 ? word : word.slice(0, equalsIndex)
    const kind = TEXT_OPTION_KINDS.get(option)
    return kind === undefined
      ? undefined
      : {
          option,
          kind,
          attachedValue:
            equalsIndex === -1 ? undefined : word.slice(equalsIndex + 1),
        }
  }
  const kind = SHORT_TEXT_OPTION_KINDS.get(word.slice(0, 2))
  if (kind === undefined) return undefined
  const attachedValue =
    word.length === 2 ? undefined : word.slice(word[2] === '=' ? 3 : 2)
  return { option: word.slice(0, 2), kind, attachedValue }
}

/**
 * Picks the options that carry text out of the words after a pull request command's action.
 *
 * Called by {@link describePullRequestCommand}.
 *
 * `--name=value`, `-bTEXT` and `-b=TEXT` carry their value; `--name value` takes the next word, whatever it looks like, as the option parser of `gh` does. Other options are passed over.
 *
 * @param words - The words after the action, expanded.
 * @returns The text options in the order written. An option with no value at the end of the command is left out.
 *
 * @example
 * ```js
 * readTextOptions(['--base', 'main', '--title-file=t.md', '-b', 'Refs #1'])
 * // => [{ option: '--title-file', kind: 'file', value: 't.md' }, { option: '-b', kind: 'text', value: 'Refs #1' }]
 * ```
 */
function readTextOptions(words) {
  const textOptions = []
  for (let index = 0; index < words.length; index += 1) {
    const parsed = parseTextOption(words[index])
    if (parsed === undefined) continue
    let value = parsed.attachedValue
    // The word after `--name` is its value, not an option.
    if (value === undefined) {
      value = words[index + 1]
      index += 1
    }
    if (value !== undefined)
      textOptions.push({ option: parsed.option, kind: parsed.kind, value })
  }
  return textOptions
}

/**
 * Works out what a file is, as of this command, given what earlier commands of the line wrote to it.
 *
 * Why: `cat > p.md <<'EOF' … EOF` and then `gh pr create --body-file p.md` posts the heredoc, whatever the disk holds before the line runs; a file that something unreadable wrote has no content this script can know.
 * Called by {@link resolveFileText}.
 *
 * @param option - The option that names the file.
 * @param path - The absolute path.
 * @param evaluation - The evaluation state, for the writes so far.
 * @returns The text: the file from the disk when nothing wrote it; the last overwriting heredoc, and the appended ones after it (after the file's current content when the first write appends). `undefined` when an earlier command wrote the file in a way this script cannot read, and no later heredoc overwrote it.
 *
 * @example
 * ```js
 * // after `cat >> /repo/p.md <<'EOF'` with body 'Refs #1\n'
 * resolveWrittenFile('--body-file', '/repo/p.md', evaluation)
 * // => { option: '--body-file', source: '/repo/p.md', fragments: [{ kind: 'file', path: '/repo/p.md', isOptional: true }, { kind: 'text', text: 'Refs #1\n' }] }
 * ```
 */
function resolveWrittenFile(option, path, evaluation) {
  let fragments = [{ kind: 'file', path, isOptional: false }]
  for (const write of evaluation.writes.get(path) ?? []) {
    if (write.mode === 'opaque') {
      fragments = undefined
    } else if (write.mode === 'overwrite') {
      fragments = [{ kind: 'text', text: write.text }]
    } else if (fragments !== undefined) {
      // An appended file may not exist yet: `>>` creates it.
      if (fragments[0].kind === 'file')
        fragments[0] = { ...fragments[0], isOptional: true }
      fragments.push({ kind: 'text', text: write.text })
    }
  }
  return fragments === undefined
    ? undefined
    : { option, source: path, fragments }
}

/**
 * Resolves the file a text option names into the text it will hold when the command runs.
 *
 * Called by {@link resolveTextOption} and {@link resolveStandardInput}.
 *
 * @param option - The option that names the file.
 * @param expandedPath - The option's value after {@link expandWord}.
 * @param scope - The scope the command is in.
 * @param evaluation - The evaluation state.
 * @returns The text (see {@link resolveWrittenFile}); `undefined` when the path cannot be resolved.
 *
 * @example
 * ```js
 * resolveFileText('--body-file', 'b.md', createScope(undefined, '/repo'), evaluation)
 * // => { option: '--body-file', source: '/repo/b.md', fragments: [{ kind: 'file', path: '/repo/b.md', isOptional: false }] }
 * ```
 */
function resolveFileText(option, expandedPath, scope, evaluation) {
  const path = resolvePath(expandedPath, scope, evaluation.environment)
  return path === undefined
    ? undefined
    : resolveWrittenFile(option, path, evaluation)
}

/**
 * Resolves `--body-file -` (or `/dev/stdin`): the text is what the same command reads from standard input.
 *
 * Why: `gh pr create --body-file - <<'EOF' … EOF` and `… -F - < body.md` write the pull request from the command line itself.
 * Called by {@link resolveTextOption}.
 *
 * @param option - The option as written.
 * @param value - What the option names: `-`, `/dev/stdin` or `/dev/fd/0`.
 * @param segment - The command that has the option.
 * @param scope - The scope the command is in.
 * @param evaluation - The evaluation state.
 * @returns For a heredoc or here-string of that command, its text, named `<option> <value>`; for `< file`, the file as {@link resolveFileText} reads it. `undefined` when standard input is a pipe or a terminal, or the heredoc has no body.
 *
 * @example
 * ```js
 * // gh pr create --body-file - <<'EOF'\nCloses #1\nEOF
 * resolveStandardInput('--body-file', '-', segment, scope, evaluation)
 * // => { option: '--body-file', source: '--body-file -', fragments: [{ kind: 'text', text: 'Closes #1\n' }] }
 * ```
 */
function resolveStandardInput(option, value, segment, scope, evaluation) {
  const input = findStandardInput(segment.redirections)
  if (input === undefined) return undefined
  if (input.operator === '<')
    return resolveFileText(
      option,
      expandWord(input.target, scope, evaluation),
      scope,
      evaluation,
    )
  const text = readInputText(input, scope, evaluation)
  return text === undefined
    ? undefined
    : {
        option,
        source: `${option} ${value}`,
        fragments: [{ kind: 'text', text: finalize(text) }],
      }
}

/**
 * Resolves one text option of a pull request command into the text it carries.
 *
 * Called by {@link describePullRequestCommand}.
 *
 * @param textOption - The option, its kind and its expanded value.
 * @param segment - The command that has the option.
 * @param scope - The scope the command is in.
 * @param evaluation - The evaluation state.
 * @returns One text; none when it cannot be known. Text given inline is returned with an unknown part kept as {@link UNKNOWN_MARK}, which no match can span; a file or standard input as {@link resolveFileText} and {@link resolveStandardInput} say.
 *
 * @example
 * ```js
 * resolveTextOption({ option: '--body', kind: 'text', value: 'Refs #1' }, segment, scope, evaluation)
 * // => [{ option: '--body', source: '--body', fragments: [{ kind: 'text', text: 'Refs #1' }] }]
 * ```
 */
function resolveTextOption(textOption, segment, scope, evaluation) {
  const { option, kind, value } = textOption
  if (kind === 'text')
    return [
      {
        option,
        source: option,
        fragments: [{ kind: 'text', text: finalize(value) }],
      },
    ]
  const text = STANDARD_INPUT_PATHS.has(value)
    ? resolveStandardInput(option, value, segment, scope, evaluation)
    : resolveFileText(option, value, scope, evaluation)
  return text === undefined ? [] : [text]
}

/**
 * Describes a command that writes pull request text: whether the line allowed a closing keyword for it, and the texts it will carry.
 *
 * Called by {@link evaluateSegment}.
 *
 * The allow is the assignment `CODEBOOK_ALLOW_CLOSING_KEYWORD=1` among the `NAME=value` words that precede the command (also after `env`), or an earlier `export` or assignment-only command of the same shell that `unset` did not undo. `echo CODEBOOK_ALLOW_CLOSING_KEYWORD=1 gh pr edit …`, a heredoc line, a subshell that has ended and a later assignment give no allow.
 *
 * @param segment - The command.
 * @param signature - Where its program and action are ({@link findPullRequestSignature}).
 * @param prefix - What stands before it ({@link readCommandPrefix}).
 * @param scope - The scope the command is in.
 * @param evaluation - The evaluation state.
 * @returns The command's allow flag and texts.
 *
 * @example
 * ```js
 * // CODEBOOK_ALLOW_CLOSING_KEYWORD=1 gh pr edit 3 --body x
 * describePullRequestCommand(segment, signature, prefix, scope, evaluation)
 * // => { isClosingKeywordAllowed: true, texts: [{ option: '--body', source: '--body', fragments: [{ kind: 'text', text: 'x' }] }] }
 * ```
 */
function describePullRequestCommand(
  segment,
  signature,
  prefix,
  scope,
  evaluation,
) {
  // Assignments belong to the command only when nothing but wrappers stands between them and it.
  const prefixAssignments =
    prefix.commandIndex >= signature.programIndex
      ? prefix.assignments.filter((word) =>
          word.startsWith(`${ALLOW_CLOSING_KEYWORD_NAME}=`),
        )
      : []
  const allowValue =
    prefixAssignments.length > 0
      ? expandWord(
          prefixAssignments.at(-1).slice(ALLOW_CLOSING_KEYWORD_NAME.length + 1),
          scope,
          evaluation,
        )
      : readScopeVariable(scope, ALLOW_CLOSING_KEYWORD_NAME)
  const argumentWords = segment.words
    .slice(signature.argumentsIndex)
    .map((word) => expandWord(word, scope, evaluation))
  return {
    isClosingKeywordAllowed: allowValue === '1',
    texts: readTextOptions(argumentWords).flatMap((textOption) =>
      resolveTextOption(textOption, segment, scope, evaluation),
    ),
  }
}

/**
 * Moves the scope's working directory the way `cd` or `pushd` does, when the target can be resolved.
 *
 * Why: `cd sub && gh pr edit 12 --body-file b.md` reads `sub/b.md`; and a directory nobody can resolve must not fall back to the hook's own, which would read the wrong file.
 * Called by {@link applyShellEffects}.
 *
 * `cd` alone goes home. The directory becomes unknown (`undefined`) for `-`, a `pushd` with no target or with `+N`, a target with an unknown part or an unresolved variable, `~name`, more than one target, a relative target while the directory is unknown, or any other option than `-L`, `-P` and `--`.
 *
 * @param operands - The words after `cd` or `pushd`.
 * @param program - `cd` or `pushd`.
 * @param scope - The scope that changes directory.
 * @param evaluation - The evaluation state.
 *
 * @example
 * ```js
 * changeDirectory(['sub'], 'cd', createScope(undefined, '/repo'), evaluation) // scope's directory is now '/repo/sub'
 * changeDirectory(['-'], 'cd', scope, evaluation)                            // scope's directory is now unknown
 * ```
 */
function changeDirectory(operands, program, scope, evaluation) {
  const expanded = operands.map((operand) =>
    expandWord(operand, scope, evaluation),
  )
  const targets = expanded.filter(
    (operand) => !['-L', '-P', '--'].includes(operand),
  )
  let target
  if (targets.length === 0 && program === 'cd') target = '~'
  else if (targets.length === 1) target = targets[0]
  const isResolvable =
    target !== undefined &&
    target !== '-' &&
    !DIRECTORY_STACK_INDEX.test(target) &&
    !(target.startsWith('-') && target.length > 1)
  scope.directory = isResolvable
    ? resolvePath(target, scope, evaluation.environment)
    : undefined
}

/**
 * Applies what a command does to the shell it runs in, for the commands after it.
 *
 * Why: an assignment, `export`, `unset` and a directory change are what the later commands of the line see; this is the line followed in order.
 * Called by {@link evaluateSegment}.
 *
 * A command made of assignments sets them; `export NAME=value` sets them; `unset NAME` removes them; `cd` and `pushd` change the directory; `popd` makes it unknown. `NAME=value command` sets nothing for what follows.
 *
 * @param segment - The command.
 * @param prefix - What stands before it ({@link readCommandPrefix}).
 * @param scope - The scope the command runs in; a command in a pipeline or in the background gets one of its own that is dropped afterwards.
 * @param evaluation - The evaluation state.
 *
 * @example
 * ```js
 * // export CODEBOOK_ALLOW_CLOSING_KEYWORD=1
 * applyShellEffects(segment, prefix, scope, evaluation) // scope now has the variable
 * ```
 */
function applyShellEffects(segment, prefix, scope, evaluation) {
  const { words } = segment
  const program = words[prefix.commandIndex]
  if (program === undefined) {
    assignWords(prefix.assignments, scope, evaluation)
    return
  }
  const programName = basename(program)
  const operands = words.slice(prefix.commandIndex + 1)
  if (programName === 'export') {
    assignWords(operands, scope, evaluation)
  } else if (programName === 'unset') {
    for (const name of operands)
      if (!name.startsWith('-')) scope.variables.set(name, UNSET)
  } else if (programName === 'cd' || programName === 'pushd') {
    changeDirectory(operands, programName, scope, evaluation)
  } else if (programName === 'popd') {
    scope.directory = undefined
  }
}

/**
 * Records the files a command writes, for the commands after it.
 *
 * Why: a file written by `cat > p.md <<'EOF'` is not on the disk when the hook runs, and one written by something this script cannot read holds nothing it can know; neither may be read from the disk as it is.
 * Called by {@link evaluateSegment}.
 *
 * `cat > f`, `cat >> f` and `cat <<'EOF' > f` with a heredoc or here-string and no file operand, and `tee [-a] f` with one, write that text (`>>` and `-a` append). Every other output redirection, and `tee` without a heredoc, writes a file this script cannot read.
 *
 * @param segment - The command.
 * @param prefix - What stands before it ({@link readCommandPrefix}).
 * @param scope - The scope the command runs in, for relative paths.
 * @param evaluation - The evaluation state; its `writes` receive the files.
 *
 * @example
 * ```js
 * // cat >> p.md <<'EOF'\nRefs #1\nEOF
 * recordWrites(segment, prefix, scope, evaluation) // evaluation.writes now has '/repo/p.md' => [{ mode: 'append', text: 'Refs #1\n' }]
 * ```
 */
function recordWrites(segment, prefix, scope, evaluation) {
  const { words, redirections } = segment
  const program = words[prefix.commandIndex]
  const programName = program === undefined ? undefined : basename(program)
  const operands =
    program === undefined ? [] : words.slice(prefix.commandIndex + 1)
  const standardInput = findStandardInput(redirections)
  const inputText =
    standardInput === undefined || standardInput.operator === '<'
      ? undefined
      : readInputText(standardInput, scope, evaluation)
  const outputs = redirections.filter((redirection) =>
    OUTPUT_OPERATORS.has(redirection.operator),
  )
  const standardOutput = outputs.findLast(
    (redirection) =>
      redirection.fd === undefined ||
      redirection.fd === '1' ||
      redirection.operator.startsWith('&'),
  )
  const writes = []
  let readableOutput
  if (
    programName === 'cat' &&
    operands.length === 0 &&
    inputText !== undefined &&
    standardOutput !== undefined
  ) {
    readableOutput = standardOutput
    writes.push({
      pathWord: standardOutput.target,
      mode: standardOutput.operator.endsWith('>>') ? 'append' : 'overwrite',
      text: finalize(inputText),
    })
  } else if (programName === 'tee') {
    const mode = operands.some(
      (operand) => operand === '-a' || operand === '--append',
    )
      ? 'append'
      : 'overwrite'
    for (const operand of operands.filter((word) => !word.startsWith('-')))
      writes.push(
        inputText === undefined
          ? { pathWord: operand, mode: 'opaque', text: undefined }
          : { pathWord: operand, mode, text: finalize(inputText) },
      )
  }
  for (const output of outputs)
    if (output !== readableOutput)
      writes.push({ pathWord: output.target, mode: 'opaque', text: undefined })
  for (const { pathWord, mode, text } of writes) {
    const path = resolvePath(
      expandWord(pathWord, scope, evaluation),
      scope,
      evaluation.environment,
    )
    if (path === undefined) continue
    const earlierWrites = evaluation.writes.get(path)
    if (earlierWrites === undefined)
      evaluation.writes.set(path, [{ mode, text }])
    else earlierWrites.push({ mode, text })
  }
}

/**
 * Evaluates one command of the line: finds out whether it writes pull request text, records the files it writes, and applies what it does to the shell.
 *
 * Called by {@link findPullRequestCommands} for every segment, in order.
 *
 * @param segment - The command.
 * @param scope - The scope it runs in.
 * @param evaluation - The evaluation state; a pull request command is added to its `commands`.
 *
 * @example
 * ```js
 * evaluateSegment(segmentOf('gh pr edit 12 --body x'), scope, evaluation) // evaluation.commands now has one command
 * ```
 */
function evaluateSegment(segment, scope, evaluation) {
  const prefix = readCommandPrefix(segment.words)
  const signature = findPullRequestSignature(segment.words)
  if (signature !== undefined)
    evaluation.commands.push(
      describePullRequestCommand(segment, signature, prefix, scope, evaluation),
    )
  recordWrites(segment, prefix, scope, evaluation)
  applyShellEffects(segment, prefix, scope, evaluation)
}

/**
 * Finds the commands of a command line that write the text of a pull request, with the texts they carry.
 *
 * Why: the hook has to know which files and strings of a Bash command will become a pull request's title or description, in the working directory and with the variables, heredocs and files the line itself sets up before them, and whether the line allowed a closing keyword on purpose.
 * Called by {@link listClosingKeywordRefusals}; the tests call it for the rules of reading a line.
 *
 * @param commandLine - The command line as the Bash tool received it.
 * @param workingDirectory - The hook input's `cwd`: where a relative path starts until a `cd` moves it.
 * @param environment - The environment to expand variables from when the line did not assign them; `process.env` by default.
 * @returns One entry per `gh pr create|edit|merge` and `gstack-post pr-body|pr-create|pr-title`, in order, also inside groups and substitutions. Empty when the line has none.
 *
 * @example
 * ```js
 * findPullRequestCommands('BODY=/tmp/b.md\ngstack-post pr-body 12 --body-file "$BODY"', '/repo', {})
 * // => [{ isClosingKeywordAllowed: false, texts: [{ option: '--body-file', source: '/tmp/b.md', fragments: [{ kind: 'file', path: '/tmp/b.md', isOptional: false }] }] }]
 * findPullRequestCommands('git status', '/repo', {}) // => []
 * ```
 */
export function findPullRequestCommands(
  commandLine,
  workingDirectory,
  environment = process.env,
) {
  const { events, substitutions } = splitCommandSegments(commandLine)
  const evaluation = {
    substitutions,
    environment,
    writes: new Map(),
    commands: [],
  }
  const outerScopes = []
  let scope = createScope(undefined, resolve(workingDirectory))
  let previousFollowedBy = ''
  for (const event of events) {
    if (event.type === 'enter') {
      outerScopes.push(scope)
      scope = createScope(scope)
      previousFollowedBy = ''
    } else if (event.type === 'leave') {
      scope = outerScopes.pop() ?? scope
      previousFollowedBy = ''
    } else {
      // A command in a pipeline or in the background runs in a subshell: what it sets is dropped.
      const isInSubshell =
        previousFollowedBy === '|' ||
        event.followedBy === '|' ||
        event.followedBy === '&'
      evaluateSegment(
        event,
        isInSubshell ? createScope(scope) : scope,
        evaluation,
      )
      previousFollowedBy = event.followedBy
    }
  }
  return evaluation.commands
}

/**
 * Reads a regular file that can be a pull request text.
 *
 * Called by {@link readPullRequestText}.
 *
 * @param path - An absolute path.
 * @returns The file's text; `undefined` for a file that does not exist or cannot be read, anything but a regular file, and a file over {@link MAX_TEXT_FILE_BYTES}.
 *
 * @example
 * ```js
 * readRegularFile('/repo/body.md') // => 'Refs #1\n'
 * readRegularFile('/repo')         // => undefined (a folder)
 * ```
 */
function readRegularFile(path) {
  try {
    const stats = statSync(path)
    if (!stats.isFile() || stats.size > MAX_TEXT_FILE_BYTES) return undefined
    return readFileSync(path, 'utf8')
  } catch {
    // A file that does not exist or cannot be read is skipped: the command itself will report it.
    return undefined
  }
}

/**
 * Puts a text together from the fragments the command line and the disk give.
 *
 * Called by {@link listClosingKeywordRefusals}.
 *
 * @param pullRequestText - A text found by {@link findPullRequestCommands}.
 * @returns Where it came from and its content: the fragments joined as the file or input will be. `undefined` when a file that must exist cannot be read.
 *
 * @example
 * ```js
 * readPullRequestText({ option: '--body', source: '--body', fragments: [{ kind: 'text', text: 'Refs #1' }] })
 * // => { source: '--body', text: 'Refs #1' }
 * ```
 */
function readPullRequestText(pullRequestText) {
  let text = ''
  for (const fragment of pullRequestText.fragments) {
    if (fragment.kind === 'text') {
      text += fragment.text
    } else {
      const content = readRegularFile(fragment.path)
      if (content === undefined && !fragment.isOptional) return undefined
      text += content ?? ''
    }
  }
  return { source: pullRequestText.source, text }
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
 * Why: this is the hook's whole decision, apart from reading standard input.
 * Called by {@link main}; the tests call it for the lines a refusal is made of.
 *
 * @param hookInput - The parsed JSON of the `PreToolUse` event: `{ tool_name, tool_input: { command }, cwd }`.
 * @param environment - The environment to expand variables from; `process.env` by default.
 * @returns Empty when the tool is not Bash, the input has no command, the command line is over {@link MAX_COMMAND_LINE_CHARACTERS}, no pull request command carries a closing keyword, or the command line allowed it. Otherwise one line per matching line, `Closing keyword before an Issue number in <file or option>, line <n>: <line>`, at most {@link MAX_REPORTED_MATCHES} of them and then one line that counts the rest, and one sentence of the fix.
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
  if (
    typeof commandLine !== 'string' ||
    commandLine.length > MAX_COMMAND_LINE_CHARACTERS
  )
    return []
  const workingDirectory =
    typeof hookInput.cwd === 'string' && hookInput.cwd !== ''
      ? hookInput.cwd
      : process.cwd()

  const matches = findPullRequestCommands(
    commandLine,
    workingDirectory,
    environment,
  )
    .filter((command) => !command.isClosingKeywordAllowed)
    .flatMap((command) => command.texts)
    .flatMap((text) => {
      const pullRequestText = readPullRequestText(text)
      if (pullRequestText === undefined) return []
      return findClosingReferences(pullRequestText.text).map((reference) => ({
        source: pullRequestText.source,
        ...reference,
      }))
    })
  if (matches.length === 0) return []
  const lines = matches
    .slice(0, MAX_REPORTED_MATCHES)
    .map(
      ({ source, lineNumber, lineText }) =>
        `Closing keyword before an Issue number in ${source}, line ${lineNumber}: ${lineText.replaceAll(UNKNOWN_MARK, '…')}`,
    )
  const notListed = matches.length - MAX_REPORTED_MATCHES
  if (notListed > 0)
    lines.push(
      `${notListed} more ${notListed === 1 ? 'line has' : 'lines have'} a closing keyword before an Issue number.`,
    )
  return [...lines, REFUSAL_FIX]
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
 * Runs when {@link isRunAsScript} says that Node started this file as the program, which is how Claude Code starts the hook.
 * Called by the check at the end of this file.
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

if (isRunAsScript(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `refuse-closing-keywords failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = FAILURE_EXIT_CODE
  })
}
